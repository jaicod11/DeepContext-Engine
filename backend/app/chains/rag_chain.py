"""
chains/rag_chain.py
--------------------
LangChain-orchestrated RAG pipeline.

Exposes two chain variants:
  • RAGChain.run()        — single-turn QA, returns full answer + citations
  • RAGChain.stream()     — single-turn QA with token-by-token streaming
  • ConversationalRAGChain.run() — multi-turn with question condensation

Both variants use the two-stage retrieval (Pinecone + reranker) from
RetrievalService and inject results into the context-aware prompt from
prompt_templates.py before sending to the LLM.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import AsyncIterator

from app.chains.prompt_templates import (
    CONDENSE_QUESTION_PROMPT,
    RAG_QA_PROMPT,
    format_context,
)
from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.services.llm_service import LLMService, get_llm_service
from app.services.retrieval_service import RetrievalService, get_retrieval_service

logger = get_logger(__name__)


# ─────────────────────────────────────────────
# Response model
# ─────────────────────────────────────────────

@dataclass
class RAGResponse:
    answer:          str
    sources:         list[dict]          # [{source, score, chunk_index, text_preview}]
    query:           str
    total_candidates: int
    reranked:        bool
    latency_ms:      int
    model:           str

    def to_dict(self) -> dict:
        return {
            "answer":           self.answer,
            "sources":          self.sources,
            "query":            self.query,
            "total_candidates": self.total_candidates,
            "reranked":         self.reranked,
            "latency_ms":       self.latency_ms,
            "model":            self.model,
        }


# ─────────────────────────────────────────────
# Single-turn RAG chain
# ─────────────────────────────────────────────

class RAGChain:
    """
    Standard single-turn retrieval-augmented generation.

    Workflow:
      query → embed → Pinecone ANN → rerank → format_context
            → ChatPromptTemplate → LLM → parse answer + sources
    """

    def __init__(
        self,
        retrieval:  RetrievalService | None = None,
        llm:        LLMService       | None = None,
        settings:   Settings         | None = None,
    ) -> None:
        self._retrieval = retrieval or get_retrieval_service()
        self._llm       = llm       or get_llm_service()
        self._settings  = settings  or get_settings()

    async def run(
        self,
        query:           str,
        namespace:       str  | None = None,
        metadata_filter: dict | None = None,
        top_k:           int  | None = None,
        top_n:           int  | None = None,
    ) -> RAGResponse:
        """Execute the full RAG pipeline and return a structured response."""
        t0 = time.perf_counter()

        # ── Stage 1+2: Retrieve + rerank ────
        retrieval_result = await self._retrieval.retrieve(
            query=query,
            top_k=top_k,
            top_n=top_n,
            namespace=namespace,
            metadata_filter=metadata_filter,
        )

        if not retrieval_result.chunks:
            return RAGResponse(
                answer=(
                    "The provided documents do not contain sufficient information "
                    "to answer this question."
                ),
                sources=[],
                query=query,
                total_candidates=0,
                reranked=False,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                model=self._settings.active_llm_model,
            )

        # ── Build context block ──────────────
        chunk_dicts = [
            {
                "text":   c.text,
                "source": c.source,
                "score":  c.score,
            }
            for c in retrieval_result.chunks
        ]
        context = format_context(chunk_dicts)

        # ── Build prompt ─────────────────────
        messages = RAG_QA_PROMPT.format_messages(
            context=context,
            question=query,
        )

        # ── Call LLM ─────────────────────────
        langchain_llm = self._llm.get_langchain_llm()
        lc_response   = await langchain_llm.ainvoke(messages)
        answer        = lc_response.content if hasattr(lc_response, "content") \
                        else str(lc_response)

        # ── Build source list ────────────────
        sources = [
            {
                "index":        i + 1,
                "source":       c.source,
                "score":        round(c.score, 4),
                "text_preview": c.text[:200] + ("…" if len(c.text) > 200 else ""),
                "vector_id":    c.vector_id,
            }
            for i, c in enumerate(retrieval_result.chunks)
        ]

        latency = int((time.perf_counter() - t0) * 1000)
        logger.info(
            "rag_chain_complete",
            query=query[:80],
            sources=len(sources),
            latency_ms=latency,
            reranked=retrieval_result.reranked,
            model=self._settings.active_llm_model,
        )

        return RAGResponse(
            answer=answer,
            sources=sources,
            query=query,
            total_candidates=retrieval_result.total_candidates,
            reranked=retrieval_result.reranked,
            latency_ms=latency,
            model=self._settings.active_llm_model,
        )

    async def stream(
        self,
        query:           str,
        namespace:       str  | None = None,
        metadata_filter: dict | None = None,
        top_k:           int  | None = None,
        top_n:           int  | None = None,
    ) -> AsyncIterator[str]:
        """
        Stream the LLM answer token-by-token as Server-Sent Events.

        Yields SSE-formatted strings:
          • "data: <token>\\n\\n"          — answer tokens
          • "data: [SOURCES] <json>\\n\\n" — sources payload at the end
          • "data: [DONE]\\n\\n"           — terminal frame

        Usage in a FastAPI route:
            return StreamingResponse(chain.stream(query), media_type="text/event-stream")
        """
        retrieval_result = await self._retrieval.retrieve(
            query=query, top_k=top_k, top_n=top_n,
            namespace=namespace, metadata_filter=metadata_filter,
        )

        if not retrieval_result.chunks:
            yield "data: The provided documents do not contain sufficient information.\n\n"
            yield "data: [DONE]\n\n"
            return

        chunk_dicts = [
            {"text": c.text, "source": c.source, "score": c.score}
            for c in retrieval_result.chunks
        ]
        context  = format_context(chunk_dicts)
        messages = RAG_QA_PROMPT.format_messages(context=context, question=query)
        prompt   = "\n".join(
            f"{m.type.upper()}: {m.content}" for m in messages
        )

        # Stream tokens
        async for token in self._llm.stream(prompt):
            yield f"data: {token}\n\n"

        # Append sources as a final SSE frame
        sources = [
            {
                "index":  i + 1,
                "source": c.source,
                "score":  round(c.score, 4),
                "text_preview": c.text[:200],
            }
            for i, c in enumerate(retrieval_result.chunks)
        ]
        yield f"data: [SOURCES] {json.dumps(sources)}\n\n"
        yield "data: [DONE]\n\n"


# ─────────────────────────────────────────────
# Multi-turn conversational chain
# ─────────────────────────────────────────────

@dataclass
class ChatMessage:
    role:    str   # "user" | "assistant"
    content: str


class ConversationalRAGChain:
    """
    Multi-turn RAG that condenses follow-up questions before retrieval.

    Example:
      Turn 1: "What are the key clauses in the NDA?"
      Turn 2: "Which of those apply to subcontractors?"  ← condensed to standalone

    The condense step rewrites turn 2 as:
      "Which NDA clauses apply to subcontractors?"
    before embedding + retrieval.
    """

    def __init__(
        self,
        retrieval: RetrievalService | None = None,
        llm:       LLMService       | None = None,
        settings:  Settings         | None = None,
    ) -> None:
        self._base     = RAGChain(retrieval=retrieval, llm=llm, settings=settings)
        self._llm      = llm     or get_llm_service()

    async def run(
        self,
        query:       str,
        history:     list[ChatMessage],
        namespace:   str  | None = None,
        filter:      dict | None = None,  # noqa: A002
    ) -> RAGResponse:
        standalone_query = await self._condense(query, history)
        logger.debug(
            "conversational_rag_condensed",
            original=query[:80],
            condensed=standalone_query[:80],
        )
        return await self._base.run(
            query=standalone_query,
            namespace=namespace,
            metadata_filter=filter,
        )

    async def _condense(self, question: str, history: list[ChatMessage]) -> str:
        """Rewrite a follow-up question as a self-contained query."""
        if not history:
            return question

        history_text = "\n".join(
            f"{m.role.capitalize()}: {m.content}" for m in history[-6:]  # last 3 turns
        )
        messages = CONDENSE_QUESTION_PROMPT.format_messages(
            chat_history=history_text,
            question=question,
        )
        langchain_llm = self._llm.get_langchain_llm()
        response      = await langchain_llm.ainvoke(messages)
        condensed     = response.content if hasattr(response, "content") else str(response)
        return condensed.strip()


# ─────────────────────────────────────────────
# Singletons
# ─────────────────────────────────────────────

_rag_chain_instance: RAGChain | None = None
_conv_chain_instance: ConversationalRAGChain | None = None


def get_rag_chain() -> RAGChain:
    global _rag_chain_instance
    if _rag_chain_instance is None:
        _rag_chain_instance = RAGChain()
    return _rag_chain_instance


def get_conversational_chain() -> ConversationalRAGChain:
    global _conv_chain_instance
    if _conv_chain_instance is None:
        _conv_chain_instance = ConversationalRAGChain()
    return _conv_chain_instance
