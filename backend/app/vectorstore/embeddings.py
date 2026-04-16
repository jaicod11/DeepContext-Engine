"""
vectorstore/embeddings.py
--------------------------
Unified embedding interface supporting Gemini, Ollama, and OpenAI backends.

Features:
  • Provider-agnostic API — swap EMBEDDING_PROVIDER in .env, zero code changes
  • Redis content-hash cache — identical text never hits the API twice
  • Async-native with asyncio.to_thread for sync SDK calls
  • Batch processing — respects EMBEDDING_BATCH_SIZE to avoid rate limits
  • BM25 sparse encoder — produces sparse vectors for hybrid Pinecone search
  • Dimension validation — raises immediately if the model output doesn't
    match PINECONE_DIMENSION, preventing silent corruption in the index
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from abc import ABC, abstractmethod
from typing import Any

import redis.asyncio as aioredis

from app.core.config import EmbeddingProvider, Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ─────────────────────────────────────────────
# Abstract base
# ─────────────────────────────────────────────

class BaseEmbedder(ABC):
    """Minimal contract every embedding backend must satisfy."""

    @abstractmethod
    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of document chunks. Returns one vector per text."""

    @abstractmethod
    async def embed_query(self, text: str) -> list[float]:
        """Embed a single query string (may use a different model task)."""

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Output vector dimension for this model."""


# ─────────────────────────────────────────────
# Gemini embedder
# ─────────────────────────────────────────────
class GeminiEmbedder(BaseEmbedder):
    """
    Calls Gemini Embeddings REST API directly.
    Bypasses langchain-google-genai and google-genai SDK version issues entirely.
    """
    _DIM = 3072   # ← changed from 768
    _URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"

    def __init__(self, settings: Settings) -> None:
        import httpx
        self._api_key = settings.gemini_api_key
        self._batch   = settings.embedding_batch_size
        self._client  = httpx.Client(timeout=30)

    @property
    def dimension(self) -> int:
        return self._DIM

    def _embed_one(self, text: str) -> list[float]:
        response = self._client.post(
            self._URL,
            params={"key": self._api_key},
            json={"model": "models/text-embedding-004", "content": {"parts": [{"text": text}]}},
        )
        response.raise_for_status()
        return response.json()["embedding"]["values"]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        results: list[list[float]] = []
        for text in texts:
            vec = await asyncio.to_thread(self._embed_one, text)
            results.append(vec)
        return results

    async def embed_query(self, text: str) -> list[float]:
        return await asyncio.to_thread(self._embed_one, text)

# ─────────────────────────────────────────────
# Ollama embedder
# ─────────────────────────────────────────────

class OllamaEmbedder(BaseEmbedder):
    """
    Calls the local Ollama server's /api/embeddings endpoint.
    Recommended model: nomic-embed-text (768-dim, fast, good quality)
    Pull with: ollama pull nomic-embed-text
    """

    def __init__(self, settings: Settings) -> None:
        import ollama  # lazy import

        self._client  = ollama.AsyncClient(host=str(settings.ollama_base_url))
        self._model   = settings.embedding_model   # e.g. "nomic-embed-text"
        self._batch   = settings.embedding_batch_size
        self._dim: int | None = None               # inferred on first call

    @property
    def dimension(self) -> int:
        if self._dim is None:
            raise RuntimeError(
                "OllamaEmbedder.dimension accessed before first embed call. "
                "Call embed_documents or embed_query first."
            )
        return self._dim

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        results: list[list[float]] = []
        for i in range(0, len(texts), self._batch):
            batch = texts[i : i + self._batch]
            for text in batch:
                resp = await self._client.embeddings(model=self._model, prompt=text)
                vec = resp["embedding"]
                if self._dim is None:
                    self._dim = len(vec)
                results.append(vec)
        return results

    async def embed_query(self, text: str) -> list[float]:
        resp = await self._client.embeddings(model=self._model, prompt=text)
        vec = resp["embedding"]
        if self._dim is None:
            self._dim = len(vec)
        return vec


# ─────────────────────────────────────────────
# BM25 sparse encoder
# ─────────────────────────────────────────────

class BM25SparseEncoder:
    """
    Lightweight BM25 encoder that produces sparse vectors compatible
    with Pinecone's hybrid search format.

    This is a simplified in-process BM25 (no external service needed).
    For production scale, replace with pinecone-text's BM25Encoder which
    uses a pre-fitted corpus vocabulary.

    Output format:
        {"indices": [int, ...], "values": [float, ...]}
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b  = b
        self._vocab:     dict[str, int]   = {}
        self._idf:       dict[str, float] = {}
        self._avg_dl:    float            = 1.0
        self._fitted:    bool             = False

    def fit(self, corpus: list[str]) -> "BM25SparseEncoder":
        """Build vocabulary and IDF scores from a corpus."""
        import math

        tokenised = [self._tokenise(doc) for doc in corpus]
        N = len(tokenised)
        self._avg_dl = sum(len(t) for t in tokenised) / max(N, 1)

        df: dict[str, int] = {}
        for tokens in tokenised:
            for tok in set(tokens):
                df[tok] = df.get(tok, 0) + 1

        idx = 0
        for tok, freq in df.items():
            self._vocab[tok] = idx
            self._idf[tok]   = math.log((N - freq + 0.5) / (freq + 0.5) + 1)
            idx += 1

        self._fitted = True
        return self

    def encode(self, text: str) -> dict[str, Any]:
        """Encode a single text into a Pinecone-compatible sparse vector."""
        if not self._fitted:
            return {"indices": [], "values": []}

        tokens = self._tokenise(text)
        dl     = len(tokens)
        tf: dict[str, int] = {}
        for tok in tokens:
            tf[tok] = tf.get(tok, 0) + 1

        indices: list[int]   = []
        values:  list[float] = []

        for tok, freq in tf.items():
            if tok not in self._vocab:
                continue
            idf  = self._idf[tok]
            norm = freq * (self.k1 + 1) / (
                freq + self.k1 * (1 - self.b + self.b * dl / self._avg_dl)
            )
            indices.append(self._vocab[tok])
            values.append(float(idf * norm))

        return {"indices": indices, "values": values}

    @staticmethod
    def _tokenise(text: str) -> list[str]:
        import re
        return re.findall(r"\b\w+\b", text.lower())


# ─────────────────────────────────────────────
# Caching layer
# ─────────────────────────────────────────────

class CachedEmbedder:
    """
    Wraps any BaseEmbedder with Redis content-hash caching.

    Cache key: SHA-256(model_name + "::" + text)
    This means the same text embedded by different models gets
    separate cache entries.
    """

    def __init__(
        self,
        backend: BaseEmbedder,
        redis_url: str,
        ttl: int = 86400,
    ) -> None:
        self._backend  = backend
        self._redis    = aioredis.from_url(redis_url, decode_responses=False)
        self._ttl      = ttl
        self._prefix   = "emb:"

    @property
    def dimension(self) -> int:
        return self._backend.dimension

    def _cache_key(self, text: str) -> str:
        digest = hashlib.sha256(
            f"{self._backend.__class__.__name__}::{text}".encode()
        ).hexdigest()
        return f"{self._prefix}{digest}"

    async def embed_query(self, text: str) -> list[float]:
        key    = self._cache_key(text)
        cached = await self._redis.get(key)
        if cached:
            logger.debug("embedding_cache_hit", chars=len(text))
            return json.loads(cached)

        vec = await self._backend.embed_query(text)
        await self._redis.setex(key, self._ttl, json.dumps(vec))
        return vec

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        results: list[list[float] | None] = [None] * len(texts)
        uncached_indices: list[int]        = []

        # Check cache for each text
        for i, text in enumerate(texts):
            key    = self._cache_key(text)
            cached = await self._redis.get(key)
            if cached:
                results[i] = json.loads(cached)
            else:
                uncached_indices.append(i)

        logger.debug(
            "embedding_cache_stats",
            total=len(texts),
            cached=len(texts) - len(uncached_indices),
            uncached=len(uncached_indices),
        )

        # Embed the misses
        if uncached_indices:
            uncached_texts = [texts[i] for i in uncached_indices]
            fresh_vecs     = await self._backend.embed_documents(uncached_texts)

            for idx, vec in zip(uncached_indices, fresh_vecs):
                key = self._cache_key(texts[idx])
                await self._redis.setex(key, self._ttl, json.dumps(vec))
                results[idx] = vec

        return results  # type: ignore[return-value]


# ─────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────

def build_embedder(settings: Settings | None = None) -> CachedEmbedder:
    """
    Build and return a CachedEmbedder based on settings.

    Usage:
        embedder = build_embedder()
        vectors  = await embedder.embed_documents(["chunk1", "chunk2"])
        q_vec    = await embedder.embed_query("What is RAG?")
    """
    s = settings or get_settings()

    backend: BaseEmbedder
    if s.embedding_provider == EmbeddingProvider.GEMINI:
        backend = GeminiEmbedder(s)
    elif s.embedding_provider == EmbeddingProvider.OLLAMA:
        backend = OllamaEmbedder(s)
    else:
        raise ValueError(f"Unsupported embedding provider: {s.embedding_provider}")

    return CachedEmbedder(
        backend=backend,
        redis_url=s.redis_url,
        ttl=s.embedding_cache_ttl,
    )


async def validate_embedding_dimension(
    embedder: CachedEmbedder,
    expected_dim: int,
) -> None:
    """
    Embed a canary text and assert the vector dimension matches
    PINECONE_DIMENSION.  Call at startup before upserting anything.
    """
    test_vec = await embedder.embed_query("dimension check")
    actual   = len(test_vec)
    if actual != expected_dim:
        raise ValueError(
            f"Embedding dimension mismatch: model returned {actual}, "
            f"but PINECONE_DIMENSION={expected_dim}. "
            f"Update PINECONE_DIMENSION in your .env file."
        )
    logger.info("embedding_dimension_validated", dimension=actual)


# ─────────────────────────────────────────────
# Singleton
# ─────────────────────────────────────────────

_embedder_instance: CachedEmbedder | None = None


def get_embedder() -> CachedEmbedder:
    """
    Return the shared CachedEmbedder instance.

    Usage in FastAPI routes:
        from app.vectorstore.embeddings import CachedEmbedder, get_embedder
        from fastapi import Depends

        @router.post("/ingest")
        async def ingest(embedder: CachedEmbedder = Depends(get_embedder)):
            ...
    """
    global _embedder_instance
    if _embedder_instance is None:
        _embedder_instance = build_embedder()
    return _embedder_instance
