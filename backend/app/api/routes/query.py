"""
api/routes/query.py
--------------------
POST /api/v1/query        — single-turn RAG (blocking or SSE stream)
POST /api/v1/query/chat   — multi-turn conversational RAG

USER SCOPING
------------
The Pinecone namespace is ALWAYS derived from the authenticated user
and never read from the request body. Even if a client sends
{"namespace": "someone_elses_namespace"}, it is ignored — retrieval
is physically confined to the caller's own vectors.

metadata_filter IS still honoured from the request, because that's how
the frontend scopes to a single document ({"document_id": {"$eq": ...}})
or a comparison set ({"document_id": {"$in": [...]}}). That's safe:
a metadata filter can only ever narrow results WITHIN the user's own
namespace, never widen them beyond it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.chains.rag_chain import (
    ChatMessage,
    ConversationalRAGChain,
    RAGChain,
    get_conversational_chain,
    get_rag_chain,
)
from app.core.auth import get_current_user
from app.models.query import (
    ConversationalQueryRequest,
    QueryRequest,
    QueryResponse,
)
from app.models.user import User

router = APIRouter(tags=["Query"])


@router.post(
    "/query",
    summary="Ask a question against your documents",
    description=(
        "Set stream=true to receive a Server-Sent Events stream instead "
        "of a single JSON response. Retrieval is confined to the "
        "authenticated user's namespace."
    ),
)
async def query(
    body:  QueryRequest,
    chain: RAGChain = Depends(get_rag_chain),
    user:  User     = Depends(get_current_user),
):
    if body.stream:
        return StreamingResponse(
            chain.stream(
                query=body.question,
                namespace=user.namespace,          # from JWT, not request
                metadata_filter=body.metadata_filter,
                top_k=body.top_k,
                top_n=body.top_n,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",         # disable nginx buffering
            },
        )

    result = await chain.run(
        query=body.question,
        namespace=user.namespace,                  # from JWT, not request
        metadata_filter=body.metadata_filter,
        top_k=body.top_k,
        top_n=body.top_n,
    )
    return QueryResponse(**result.to_dict())


@router.post(
    "/query/chat",
    response_model=QueryResponse,
    summary="Multi-turn conversational RAG",
)
async def conversational_query(
    body:  ConversationalQueryRequest,
    chain: ConversationalRAGChain = Depends(get_conversational_chain),
    user:  User                   = Depends(get_current_user),
) -> QueryResponse:
    history = [ChatMessage(role=m.role, content=m.content) for m in body.history]
    result = await chain.run(
        query=body.question,
        history=history,
        namespace=user.namespace,                  # from JWT, not request
        filter=body.metadata_filter,
    )
    return QueryResponse(**result.to_dict())