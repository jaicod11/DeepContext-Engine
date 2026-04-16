"""
services/retrieval_service.py
------------------------------
Orchestrates the two-stage retrieval pipeline:

  Stage 1 — Pinecone hybrid query (dense ANN + sparse BM25)
              Returns top-K candidates quickly (~20–50ms)

  Stage 2 — Cross-encoder reranking
              Scores each candidate against the full query text
              Returns top-N precision-ranked chunks (~100–200ms on CPU)

The RetrievalService is the only component in the codebase that touches
both the vector store and the reranker — it owns the retrieval contract.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.services.reranker_service import RankedChunk, RerankerService, get_reranker
from app.vectorstore.embeddings import CachedEmbedder, BM25SparseEncoder, get_embedder
from app.vectorstore.pinecone_client import PineconeClient, get_pinecone_client

logger = get_logger(__name__)


@dataclass
class RetrievalResult:
    """Final output of the retrieval pipeline, ready for the LLM."""
    chunks:           list[RankedChunk]
    query_text:       str
    total_candidates: int            # raw Pinecone hits before reranking
    reranked:         bool


class RetrievalService:
    def __init__(
        self,
        pinecone:  PineconeClient  | None = None,
        embedder:  CachedEmbedder  | None = None,
        reranker:  RerankerService | None = None,
        settings:  Settings        | None = None,
        bm25:      BM25SparseEncoder | None = None,
    ) -> None:
        self._pc       = pinecone  or get_pinecone_client()
        self._embedder = embedder  or get_embedder()
        self._reranker = reranker  or get_reranker()
        self._settings = settings  or get_settings()
        self._bm25     = bm25      # optional; set after corpus is fitted

    # ─────────────────────────────────────────
    # Main entry point
    # ─────────────────────────────────────────

    async def retrieve(
        self,
        query:           str,
        top_k:           int  | None = None,
        top_n:           int  | None = None,
        namespace:       str  | None = None,
        metadata_filter: dict | None = None,
        use_hybrid:      bool        = True,
    ) -> RetrievalResult:
        """
        Full two-stage retrieval for a single query.

        Parameters
        ----------
        query           : Raw user question string.
        top_k           : Pinecone candidate pool size (default: settings.retrieval_top_k).
        top_n           : Final chunks after reranking (default: settings.reranker_top_n).
        namespace       : Pinecone namespace override.
        metadata_filter : Optional Pinecone metadata filter, e.g.
                          {"doc_type": {"$eq": "contract"}}.
        use_hybrid      : Whether to include BM25 sparse vector (requires fitted BM25).
        """
        s = self._settings

        # 1. Embed the query
        logger.debug("retrieval_embedding_query", chars=len(query))
        dense_vector = await self._embedder.embed_query(query)

        # 2. Build optional sparse vector
        sparse_vector = None
        if use_hybrid and self._bm25 and self._bm25._fitted:
            sparse_vector = self._bm25.encode(query)
            logger.debug("retrieval_sparse_encoded", indices=len(sparse_vector["indices"]))

        # 3. Stage 1 — Pinecone ANN / hybrid query
        raw_results = await self._pc.query(
            dense_vector=dense_vector,
            top_k=top_k or s.retrieval_top_k,
            namespace=namespace,
            filter=metadata_filter,
            sparse_vector=sparse_vector,
            score_threshold=s.similarity_score_threshold,
        )

        if not raw_results:
            logger.info("retrieval_no_candidates", query=query[:80])
            return RetrievalResult(
                chunks=[],
                query_text=query,
                total_candidates=0,
                reranked=False,
            )

        # 4. Convert to flat dicts for the reranker
        candidates = [
            {
                "text":      r.text,
                "source":    r.source,
                "score":     r.score,
                "vector_id": r.vector_id,
                "metadata":  r.metadata,
            }
            for r in raw_results
        ]

        logger.debug(
            "retrieval_stage1_done",
            candidates=len(candidates),
            top_score=round(candidates[0]["score"], 4) if candidates else 0,
        )

        # 5. Stage 2 — Cross-encoder reranking
        ranked_chunks = await self._reranker.rerank(
            query=query,
            candidates=candidates,
            top_n=top_n or s.reranker_top_n,
        )

        logger.info(
            "retrieval_complete",
            query=query[:80],
            candidates=len(candidates),
            returned=len(ranked_chunks),
            reranked=s.reranker_enabled,
            top_score=round(ranked_chunks[0].score, 4) if ranked_chunks else 0,
        )

        return RetrievalResult(
            chunks=ranked_chunks,
            query_text=query,
            total_candidates=len(candidates),
            reranked=s.reranker_enabled,
        )

    # ─────────────────────────────────────────
    # BM25 corpus fitting
    # ─────────────────────────────────────────

    def fit_bm25(self, corpus: list[str]) -> None:
        """
        Fit the BM25 encoder on a document corpus.
        Call after bulk ingestion and persist the fitted encoder.
        """
        if self._bm25 is None:
            self._bm25 = BM25SparseEncoder()
        self._bm25.fit(corpus)
        logger.info("bm25_fitted", corpus_size=len(corpus))


# ─────────────────────────────────────────────
# Singleton
# ─────────────────────────────────────────────

_retrieval_instance: RetrievalService | None = None


def get_retrieval_service() -> RetrievalService:
    global _retrieval_instance
    if _retrieval_instance is None:
        _retrieval_instance = RetrievalService()
    return _retrieval_instance
