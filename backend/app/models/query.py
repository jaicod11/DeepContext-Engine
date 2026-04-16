"""
models/query.py
----------------
Pydantic v2 schemas specific to RAG query requests and responses.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


# ──────────────────────────────────────────────
# Request models
# ──────────────────────────────────────────────

class QueryRequest(BaseModel):
    """Single-turn RAG query."""

    question: str = Field(
        ...,
        min_length=3,
        max_length=2000,
        description="The question to answer from the document corpus.",
        examples=["What are the key termination clauses in the SLA?"],
    )
    namespace: str | None = Field(
        default=None,
        description="Pinecone namespace to restrict retrieval to.",
    )
    metadata_filter: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Pinecone metadata filter applied before retrieval. "
            "Example: {\"doc_type\": {\"$eq\": \"contract\"}}"
        ),
    )
    top_k: int | None = Field(
        default=None,
        ge=1,
        le=100,
        description="ANN candidate pool size. Overrides settings.retrieval_top_k.",
    )
    top_n: int | None = Field(
        default=None,
        ge=1,
        le=20,
        description="Final chunks after reranking. Overrides settings.reranker_top_n.",
    )
    stream: bool = Field(
        default=False,
        description=(
            "If true, the endpoint returns a Server-Sent Events stream "
            "instead of a blocking JSON response."
        ),
    )

    @model_validator(mode="after")
    def _top_n_le_top_k(self) -> "QueryRequest":
        if self.top_k and self.top_n and self.top_n > self.top_k:
            raise ValueError(
                f"top_n ({self.top_n}) must be ≤ top_k ({self.top_k})"
            )
        return self

    model_config = {"json_schema_extra": {
        "example": {
            "question":        "What are the payment terms in the contract?",
            "namespace":       "tenant-acme",
            "metadata_filter": {"doc_type": {"$eq": "contract"}},
            "top_k":           20,
            "top_n":           5,
            "stream":          False,
        }
    }}


class ChatMessage(BaseModel):
    """A single turn in a multi-turn conversation."""

    role:    str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)


class ConversationalQueryRequest(QueryRequest):
    """
    Multi-turn RAG query.

    The `history` list contains previous turns in chronological order
    (oldest first, most recent last).  The backend condenses the follow-up
    `question` against this history before retrieval.
    """

    history: list[ChatMessage] = Field(
        default_factory=list,
        max_length=20,
        description="Previous conversation turns. Oldest first, most recent last.",
    )

    model_config = {"json_schema_extra": {
        "example": {
            "question": "Which of those apply to subcontractors?",
            "history": [
                {"role": "user",      "content": "What are the key NDA clauses?"},
                {"role": "assistant", "content": "The NDA covers confidentiality, ..."},
            ],
            "namespace": "default",
        }
    }}


# ──────────────────────────────────────────────
# Response models
# ──────────────────────────────────────────────

class SourceChunk(BaseModel):
    """One retrieved chunk shown in the citations panel."""

    index:        int   = Field(..., description="1-based position matching [SOURCE N] in the answer.")
    source:       str   = Field(..., description="Document filename or source label.")
    score:        float = Field(..., description="Cross-encoder reranking score.")
    text_preview: str   = Field(..., description="First 200 chars of the chunk text.")
    vector_id:    str   = Field(..., description="Pinecone vector ID for direct lookup.")


class QueryResponse(BaseModel):
    """Full RAG answer with grounded citations and pipeline metadata."""

    answer:           str              = Field(..., description="LLM-generated answer with [SOURCE N] citations.")
    sources:          list[SourceChunk]
    query:            str              = Field(..., description="The original (or condensed) question.")
    total_candidates: int              = Field(..., description="Raw Pinecone hits before reranking.")
    reranked:         bool             = Field(..., description="Whether cross-encoder reranking was applied.")
    latency_ms:       int              = Field(..., description="End-to-end pipeline latency in milliseconds.")
    model:            str              = Field(..., description="LLM model used to generate the answer.")

    model_config = {"json_schema_extra": {
        "example": {
            "answer":           "The payment terms require invoices within 30 days [SOURCE 1][SOURCE 3].",
            "sources": [
                {
                    "index":        1,
                    "source":       "contract-2024.pdf",
                    "score":        0.9821,
                    "text_preview": "Invoices must be submitted within 30 calendar days...",
                    "vector_id":    "a1b2c3d4-0",
                }
            ],
            "query":            "What are the payment terms in the contract?",
            "total_candidates": 18,
            "reranked":         True,
            "latency_ms":       312,
            "model":            "gemini-1.5-pro",
        }
    }}


# ──────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────

class HealthResponse(BaseModel):
    status:   str
    version:  str
    pinecone: dict[str, Any]
