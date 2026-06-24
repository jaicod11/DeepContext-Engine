"""
chains/rag_chain.py
--------------------
LangChain-orchestrated RAG pipeline.
Sources now include page_number, slide_number, sheet_name from chunk metadata.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
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


@dataclass
class RAGResponse:
    answer:           str
    sources:          list[dict]
    query:            str
    total_candidates: int
    reranked:         bool
    latency_ms:       int
    model:            str

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


def _build_source(index: int, chunk) -> dict:
    """
    Build a source dict from a RankedChunk, pulling page/slide/sheet
    metadata from the chunk's Pinecone metadata dict.
    """
    meta = chunk.metadata or {}
    return {
        "index":        index,
        "source":       chunk.source,
        "score":        round(chunk.score, 4),
        "text_preview": chunk.text[:200] + ("…" if len(chunk.text) > 200 else ""),
        "vector_id":    chunk.vector_id,
        # Page-level attribution — present for PDFs, PPTX, None for others
        "page_number":  meta.get("page_number"),
        "slide_number": meta.get("slide_number"),
        "sheet_name":   meta.get("sheet_name"),
    }


class RAGChain:
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
        t0 = time.perf_counter()

        retrieval_result = await self._retrieval.retrieve(
            query=query, top_k=top_k, top_n=top_n,
            namespace=namespace, metadata_filter=metadata_filter,
        )

        if not retrieval_result.chunks:
            return RAGResponse(
                answer=(
                    "The provided documents do not contain sufficient information "
                    "to answer this question."
                ),
                sources=[], query=query, total_candidates=0,
                reranked=False,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                model=self._settings.active_llm_model,
            )

        chunk_dicts = [
            {"text": c.text, "source": c.source, "score": c.score}
            for c in retrieval_result.chunks
        ]
        context  = format_context(chunk_dicts)
        messages = RAG_QA_PROMPT.format_messages(context=context, question=query)

        langchain_llm = self._llm.get_langchain_llm()
        lc_response   = await langchain_llm.ainvoke(messages)
        answer        = lc_response.content if hasattr(lc_response, "content") \
                        else str(lc_response)

        # Build sources with page attribution
        sources = [
            _build_source(i + 1, c)
            for i, c in enumerate(retrieval_result.chunks)
        ]

        latency = int((time.perf_counter() - t0) * 1000)
        logger.info(
            "rag_chain_complete",
            query=query[:80], sources=len(sources),
            latency_ms=latency, reranked=retrieval_result.reranked,
            model=self._settings.active_llm_model,
        )

        return RAGResponse(
            answer=answer, sources=sources, query=query,
            total_candidates=retrieval_result.total_candidates,
            reranked=retrieval_result.reranked,
            latency_ms=latency, model=self._settings.active_llm_model,
        )

    async def stream(
        self,
        query:           str,
        namespace:       str  | None = None,
        metadata_filter: dict | None = None,
        top_k:           int  | None = None,
        top_n:           int  | None = None,
    ) -> AsyncIterator[str]:
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
        prompt   = "\n".join(f"{m.type.upper()}: {m.content}" for m in messages)

        async for token in self._llm.stream(prompt):
            yield f"data: {token}\n\n"

        # Sources with page attribution included in final SSE frame
        sources = [_build_source(i + 1, c) for i, c in enumerate(retrieval_result.chunks)]
        yield f"data: [SOURCES] {json.dumps(sources)}\n\n"
        yield "data: [DONE]\n\n"


# ─── Multi-turn ───────────────────────────────────────────────────────────────

@dataclass
class ChatMessage:
    role:    str
    content: str


class ConversationalRAGChain:
    def __init__(
        self,
        retrieval: RetrievalService | None = None,
        llm:       LLMService       | None = None,
        settings:  Settings         | None = None,
    ) -> None:
        self._base = RAGChain(retrieval=retrieval, llm=llm, settings=settings)
        self._llm  = llm or get_llm_service()

    async def run(
        self,
        query:     str,
        history:   list[ChatMessage],
        namespace: str  | None = None,
        filter:    dict | None = None,  # noqa: A002
    ) -> RAGResponse:
        standalone_query = await self._condense(query, history)
        logger.debug(
            "conversational_rag_condensed",
            original=query[:80], condensed=standalone_query[:80],
        )
        return await self._base.run(
            query=standalone_query, namespace=namespace, metadata_filter=filter,
        )

    async def _condense(self, question: str, history: list[ChatMessage]) -> str:
        if not history:
            return question
        history_text = "\n".join(
            f"{m.role.capitalize()}: {m.content}" for m in history[-6:]
        )
        messages = CONDENSE_QUESTION_PROMPT.format_messages(
            chat_history=history_text, question=question,
        )
        langchain_llm = self._llm.get_langchain_llm()
        response      = await langchain_llm.ainvoke(messages)
        condensed     = response.content if hasattr(response, "content") else str(response)
        return condensed.strip()


# ─── Singletons ───────────────────────────────────────────────────────────────

_rag_chain_instance:  RAGChain | None = None
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