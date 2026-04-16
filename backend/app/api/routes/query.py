"""
api/routes/query.py
--------------------
POST /api/v1/query         — single-turn RAG (blocking or SSE streaming)
POST /api/v1/query/chat    — multi-turn conversational RAG
"""
from __future__ import annotations
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.chains.rag_chain import (
    ConversationalRAGChain, RAGChain,
    get_conversational_chain, get_rag_chain,
)
from app.core.security import require_api_key
from app.models.query import (
    ConversationalQueryRequest,
    QueryRequest,
    QueryResponse,
    SourceChunk,
)

router = APIRouter(prefix="/query", tags=["Query"])

@router.post("", response_model=QueryResponse, summary="Single-turn RAG query")
async def query(
    body:  QueryRequest,
    chain: RAGChain = Depends(get_rag_chain),
    _key:  str      = Depends(require_api_key),
) -> QueryResponse | StreamingResponse:
    if body.stream:
        return StreamingResponse(
            chain.stream(
                query=body.question,
                namespace=body.namespace,
                metadata_filter=body.metadata_filter,
                top_k=body.top_k, top_n=body.top_n,
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    result = await chain.run(
        query=body.question, namespace=body.namespace,
        metadata_filter=body.metadata_filter,
        top_k=body.top_k, top_n=body.top_n,
    )
    return QueryResponse(
        answer=result.answer,
        sources=[SourceChunk(**s) for s in result.sources],
        query=result.query, total_candidates=result.total_candidates,
        reranked=result.reranked, latency_ms=result.latency_ms, model=result.model,
    )

@router.post("/chat", response_model=QueryResponse, summary="Multi-turn conversational RAG")
async def chat(
    body:  ConversationalQueryRequest,
    chain: ConversationalRAGChain = Depends(get_conversational_chain),
    _key:  str = Depends(require_api_key),
) -> QueryResponse:
    from app.chains.rag_chain import ChatMessage as ChainMsg
    history = [ChainMsg(role=m.role, content=m.content) for m in body.history]
    result  = await chain.run(
        query=body.question, history=history,
        namespace=body.namespace, filter=body.metadata_filter,
    )
    return QueryResponse(
        answer=result.answer,
        sources=[SourceChunk(**s) for s in result.sources],
        query=result.query, total_candidates=result.total_candidates,
        reranked=result.reranked, latency_ms=result.latency_ms, model=result.model,
    )
