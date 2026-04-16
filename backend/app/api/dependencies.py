"""
api/dependencies.py
--------------------
Shared FastAPI dependency providers.

All heavy objects (Pinecone client, embedder, reranker, chains) are
singletons initialised at startup.  This module wires them into the
FastAPI dependency-injection system so every route receives the same
cached instance — no per-request construction overhead.

Usage in a route:
    from app.api.dependencies import get_rag, get_ingestion, get_pc

    @router.post("/query")
    async def query_endpoint(
        body:  QueryRequest,
        chain: RAGChain        = Depends(get_rag),
        _key:  str             = Depends(require_api_key),
    ): ...
"""

from __future__ import annotations

from fastapi import Depends, Request

from app.chains.rag_chain import (
    ConversationalRAGChain,
    RAGChain,
    get_conversational_chain,
    get_rag_chain,
)
from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.services.ingestion_service import IngestionService, get_ingestion_service
from app.services.llm_service import LLMService, get_llm_service
from app.services.reranker_service import RerankerService, get_reranker
from app.services.retrieval_service import RetrievalService, get_retrieval_service
from app.vectorstore.embeddings import CachedEmbedder, get_embedder
from app.vectorstore.pinecone_client import PineconeClient, get_pinecone_client

logger = get_logger(__name__)


# ──────────────────────────────────────────────
# Infrastructure
# ──────────────────────────────────────────────

def get_pc() -> PineconeClient:
    """Inject the shared Pinecone client."""
    return get_pinecone_client()


def get_embedder_dep() -> CachedEmbedder:
    """Inject the cached embedding model wrapper."""
    return get_embedder()


def get_reranker_dep() -> RerankerService:
    """Inject the cross-encoder reranker."""
    return get_reranker()


def get_settings_dep() -> Settings:
    """Inject application settings (cached, zero cost)."""
    return get_settings()


# ──────────────────────────────────────────────
# Service layer
# ──────────────────────────────────────────────

def get_llm(settings: Settings = Depends(get_settings_dep)) -> LLMService:
    """Inject the LLM service (Gemini or Ollama)."""
    return get_llm_service()


def get_retrieval(
    pc:       PineconeClient  = Depends(get_pc),
    embedder: CachedEmbedder  = Depends(get_embedder_dep),
    reranker: RerankerService = Depends(get_reranker_dep),
) -> RetrievalService:
    """Inject the two-stage retrieval service."""
    return get_retrieval_service()


def get_ingestion(
    pc:       PineconeClient = Depends(get_pc),
    embedder: CachedEmbedder = Depends(get_embedder_dep),
) -> IngestionService:
    """Inject the document ingestion service."""
    return get_ingestion_service()


# ──────────────────────────────────────────────
# Chain layer
# ──────────────────────────────────────────────

def get_rag(
    retrieval: RetrievalService = Depends(get_retrieval),
    llm:       LLMService       = Depends(get_llm),
) -> RAGChain:
    """Inject the single-turn RAG chain."""
    return get_rag_chain()


def get_conv_rag(
    retrieval: RetrievalService = Depends(get_retrieval),
    llm:       LLMService       = Depends(get_llm),
) -> ConversationalRAGChain:
    """Inject the multi-turn conversational RAG chain."""
    return get_conversational_chain()


# ──────────────────────────────────────────────
# Request-scoped helpers
# ──────────────────────────────────────────────

def get_request_namespace(request: Request) -> str | None:
    """
    Extract an optional namespace from the X-Namespace header.
    Routes can use this to scope Pinecone queries per tenant/user
    without requiring it in every request body.

    Example header:  X-Namespace: tenant-acme
    """
    return request.headers.get("X-Namespace")


def get_pagination(
    page:     int = 1,
    per_page: int = 20,
) -> dict:
    """
    Standard pagination query parameters.
    Used by list endpoints (e.g. GET /documents).
    """
    per_page = min(per_page, 100)   # hard cap
    offset   = (page - 1) * per_page
    return {"page": page, "per_page": per_page, "offset": offset}
