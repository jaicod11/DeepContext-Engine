"""
models/document.py
-------------------
Pydantic v2 schemas specific to document ingestion and management.

Kept separate from query.py so each domain stays focused and imports
remain unambiguous (e.g. `from app.models.document import IngestResponse`).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class DocumentStatus(str, Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    COMPLETE   = "complete"
    FAILED     = "failed"


class SupportedFileType(str, Enum):
    PDF  = ".pdf"
    DOCX = ".docx"
    TXT  = ".txt"
    MD   = ".md"
    HTML = ".html"
    HTM  = ".htm"


# ──────────────────────────────────────────────
# Ingest requests
# ──────────────────────────────────────────────

class IngestTextRequest(BaseModel):
    """Ingest a raw text string directly (no file upload needed)."""

    text: str = Field(
        ...,
        min_length=10,
        max_length=500_000,
        description="Raw document text to ingest.",
        examples=["This Service Level Agreement ('SLA') is entered into..."],
    )
    source: str = Field(
        default="inline",
        max_length=255,
        description="Human-readable label shown in source citations.",
        examples=["Q3-2024-earnings-call.txt"],
    )
    namespace: str | None = Field(
        default=None,
        description="Pinecone namespace to upsert into. Defaults to settings.pinecone_namespace.",
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Arbitrary key-value metadata stored alongside each vector.",
        examples=[{"department": "legal", "year": 2024}],
    )
    document_id: str | None = Field(
        default=None,
        description=(
            "Stable document identifier. If provided and the document already "
            "exists, old chunks are deleted before re-ingestion (idempotent). "
            "Auto-generated from content SHA-256 if omitted."
        ),
    )

    @field_validator("source")
    @classmethod
    def _no_path_separators(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("source must not contain path separators (/ or \\)")
        return v


# ──────────────────────────────────────────────
# Ingest responses
# ──────────────────────────────────────────────

class IngestResponse(BaseModel):
    """Returned after a successful ingestion (file upload or raw text)."""

    document_id:      str   = Field(..., description="Stable ID used to re-ingest or delete.")
    filename:         str   = Field(..., description="Original file name or source label.")
    chunks_total:     int   = Field(..., description="Number of text chunks produced by the splitter.")
    vectors_upserted: int   = Field(..., description="Vectors actually written to Pinecone.")
    namespace:        str   = Field(..., description="Pinecone namespace the vectors were written to.")
    status:           DocumentStatus = Field(default=DocumentStatus.COMPLETE)

    model_config = {"json_schema_extra": {
        "example": {
            "document_id":      "a1b2c3d4e5f6a7b8",
            "filename":         "quarterly-report.pdf",
            "chunks_total":     142,
            "vectors_upserted": 142,
            "namespace":        "default",
            "status":           "complete",
        }
    }}


# ──────────────────────────────────────────────
# Document metadata record (for list / fetch endpoints)
# ──────────────────────────────────────────────

class DocumentRecord(BaseModel):
    """
    A lightweight document descriptor stored alongside vectors as metadata.
    Returned by GET /documents and GET /documents/{id}.
    """

    document_id:   str
    filename:      str
    namespace:     str
    chunks:        int
    status:        DocumentStatus
    ingested_at:   datetime | None = None
    file_type:     str | None      = None
    size_bytes:    int | None      = None
    extra_metadata: dict[str, Any] = Field(default_factory=dict)


# ──────────────────────────────────────────────
# Delete
# ──────────────────────────────────────────────

class DeleteDocumentResponse(BaseModel):
    document_id: str
    namespace:   str
    deleted:     bool = True
    message:     str  = "All chunks deleted successfully."


# ──────────────────────────────────────────────
# Index stats
# ──────────────────────────────────────────────

class IndexStatsResponse(BaseModel):
    """Pinecone index-level statistics."""

    total_vectors:  int
    dimension:      int
    namespaces:     dict[str, int] = Field(
        description="namespace → vector count mapping",
    )
    index_fullness: float = Field(
        description="Fraction of index capacity used (0.0–1.0).",
    )

    model_config = {"json_schema_extra": {
        "example": {
            "total_vectors": 8432,
            "dimension":     768,
            "namespaces":    {"default": 6100, "tenant-acme": 2332},
            "index_fullness": 0.0084,
        }
    }}
