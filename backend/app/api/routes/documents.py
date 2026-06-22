"""
api/routes/documents.py
------------------------
POST   /api/v1/documents/upload   — multipart file upload + ingestion
POST   /api/v1/documents/text     — ingest raw text
DELETE /api/v1/documents/{id}     — delete document chunks
GET    /api/v1/documents/stats    — Pinecone index statistics
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core.security import require_api_key
from app.models.document import (
    IndexStatsResponse,
    IngestResponse,
    IngestTextRequest,
)
from app.services.ingestion_service import IngestionService, get_ingestion_service
from app.vectorstore.pinecone_client import PineconeClient, get_pinecone_client

router = APIRouter(prefix="/documents", tags=["Documents"])

# ── Allowed file types ──────────────────────────────────────────────────────
_ALLOWED_EXTENSIONS: set[str] = {
    ".pdf",
    ".docx",
    ".txt",
    ".md",
    ".html",
    ".htm",
    ".pptx",   # ← NEW: PowerPoint
    ".xlsx",   # ← NEW: Excel (modern)
    ".xls",    # ← NEW: Excel (legacy)
}

_MAX_FILE_SIZE = 50 * 1024 * 1024   # 50 MB


@router.post(
    "/upload",
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and ingest a document",
    description=(
        "Accepts PDF, DOCX, TXT, MD, HTML, PPTX, and XLSX files up to 50 MB. "
        "Text is extracted, split into semantic chunks, embedded via Gemini, "
        "and upserted to Pinecone."
    ),
)
async def upload_document(
    file:      UploadFile  = File(...),
    namespace: str | None  = Form(default=None),
    svc:       IngestionService = Depends(get_ingestion_service),
    _key:      str              = Depends(require_api_key),
) -> IngestResponse:

    # Validate extension
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"File type '{suffix}' is not supported. "
                f"Allowed: {sorted(_ALLOWED_EXTENSIONS)}"
            ),
        )

    # Read and size-check
    content = await file.read()
    if len(content) > _MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds the 50 MB limit.",
        )

    # Write to temp file and ingest
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = await svc.ingest_file(
            file_path=tmp_path,
            namespace=namespace,
            metadata={"original_filename": file.filename},
        )
    finally:
        os.unlink(tmp_path)

    return IngestResponse(
        document_id=result.document_id,
        filename=result.filename,
        chunks_total=result.chunks_total,
        vectors_upserted=result.vectors_upserted,
        namespace=result.namespace,
    )


@router.post(
    "/text",
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest raw text",
)
async def ingest_text(
    body: IngestTextRequest,
    svc:  IngestionService = Depends(get_ingestion_service),
    _key: str              = Depends(require_api_key),
) -> IngestResponse:
    result = await svc.ingest_text(
        text=body.text,
        source=body.source,
        namespace=body.namespace,
        metadata=body.metadata,
        document_id=body.document_id,
    )
    return IngestResponse(
        document_id=result.document_id,
        filename=result.filename,
        chunks_total=result.chunks_total,
        vectors_upserted=result.vectors_upserted,
        namespace=result.namespace,
    )


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete all chunks for a document",
)
async def delete_document(
    document_id: str,
    namespace:   str | None = None,
    svc:         IngestionService = Depends(get_ingestion_service),
    _key:        str = Depends(require_api_key),
) -> None:
    await svc.delete_document(document_id=document_id, namespace=namespace)


@router.get(
    "/stats",
    response_model=IndexStatsResponse,
    summary="Pinecone index statistics",
)
async def index_stats(
    pc:   PineconeClient = Depends(get_pinecone_client),
    _key: str            = Depends(require_api_key),
) -> IndexStatsResponse:
    stats = await pc.get_stats()
    return IndexStatsResponse(
        total_vectors=stats.total_vectors,
        dimension=stats.dimension,
        namespaces=stats.namespaces,
        index_fullness=stats.index_fullness,
    )