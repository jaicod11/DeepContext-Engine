"""
models/query.py
----------------
Pydantic v2 schemas for RAG query requests and responses.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


class QueryRequest(BaseModel):
    question: str = Field(
        ..., min_length=3, max_length=2000,
        description="The question to answer from the document corpus.",
        examples=["What are the key termination clauses in the SLA?"],
    )
    namespace: str | None = Field(default=None)
    metadata_filter: dict[str, Any] | None = Field(default=None)
    top_k: int | None = Field(default=None, ge=1, le=100)
    top_n: int | None = Field(default=None, ge=1, le=20)
    stream: bool = Field(default=False)

    @model_validator(mode="after")
    def _top_n_le_top_k(self) -> "QueryRequest":
        if self.top_k and self.top_n and self.top_n > self.top_k:
            raise ValueError(f"top_n ({self.top_n}) must be ≤ top_k ({self.top_k})")
        return self


class ChatMessage(BaseModel):
    role:    str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)


class ConversationalQueryRequest(QueryRequest):
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)


class SourceChunk(BaseModel):
    """One retrieved chunk shown in the citations panel."""

    index:        int
    source:       str
    score:        float
    text_preview: str
    vector_id:    str
    page_number:  int | None = Field(
        default=None,
        description=(
            "1-indexed page number from the source document. "
            "Set for PDFs and PPTX slides. None for other formats "
            "or documents ingested before page tracking was added."
        ),
    )
    slide_number: int | None = Field(
        default=None,
        description="1-indexed slide number for PPTX files. Mirrors page_number.",
    )
    sheet_name: str | None = Field(
        default=None,
        description="Sheet name for XLSX files.",
    )

    # Allow extra Pinecone metadata fields to pass through without error
    model_config = {"extra": "ignore"}


class QueryResponse(BaseModel):
    answer:           str
    sources:          list[SourceChunk]
    query:            str
    total_candidates: int
    reranked:         bool
    latency_ms:       int
    model:            str


class HealthResponse(BaseModel):
    status:   str
    version:  str
    pinecone: dict[str, Any]