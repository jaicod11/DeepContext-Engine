"""
api/routes/documents.py
------------------------
All routes are now USER-SCOPED. Every operation is confined to the
caller's own Pinecone namespace (user_<uuid>), so one account can
never read, query, or delete another account's documents.

GET    /api/v1/documents          — list MY documents (persists!)
POST   /api/v1/documents/upload   — upload into MY namespace
POST   /api/v1/documents/text     — ingest raw text into MY namespace
DELETE /api/v1/documents/{id}     — delete MY document only
GET    /api/v1/documents/stats    — index statistics
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.document import IndexStatsResponse, IngestResponse, IngestTextRequest
from app.models.document_record import DocumentRecord, DocumentRecordResponse
from app.models.user import User
from app.services.ingestion_service import IngestionService, get_ingestion_service
from app.vectorstore.pinecone_client import PineconeClient, get_pinecone_client

router = APIRouter(prefix="/documents", tags=["Documents"])

_ALLOWED_EXTENSIONS: set[str] = {
    ".pdf", ".docx", ".txt", ".md", ".html", ".htm",
    ".pptx", ".xlsx", ".xls",
}

_MAX_FILE_SIZE = 50 * 1024 * 1024   # 50 MB


@router.get(
    "",
    response_model=list[DocumentRecordResponse],
    summary="List all documents owned by the current user",
    description=(
        "Returns the caller's persistent document library, newest first. "
        "This is what makes uploaded documents survive page refreshes and "
        "re-logins — the list is stored relationally, not just in browser state."
    ),
)
async def list_documents(
    user: User = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
) -> list[DocumentRecordResponse]:
    result = await db.execute(
        select(DocumentRecord)
        .where(DocumentRecord.user_id == user.id)
        .order_by(DocumentRecord.uploaded_at.desc())
    )
    records = result.scalars().all()
    return [DocumentRecordResponse.model_validate(r) for r in records]


@router.post(
    "/upload",
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and ingest a document into your private namespace",
)
async def upload_document(
    file: UploadFile        = File(...),
    svc:  IngestionService  = Depends(get_ingestion_service),
    user: User              = Depends(get_current_user),
    db:   AsyncSession      = Depends(get_db),
) -> IngestResponse:

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"File type '{suffix}' is not supported. "
                f"Allowed: {sorted(_ALLOWED_EXTENSIONS)}"
            ),
        )

    content = await file.read()
    if len(content) > _MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds the 50 MB limit.",
        )

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Namespace is derived from the authenticated user — NEVER taken
        # from the request body. A client cannot ask to write into
        # someone else's namespace.
        result = await svc.ingest_file(
            file_path=tmp_path,
            namespace=user.namespace,
            metadata={
                "original_filename": file.filename,
                "owner_id": user.id,
            },
        )
    finally:
        os.unlink(tmp_path)

    original_name = file.filename or result.filename

    # Upsert the library record (re-uploading the same file updates it
    # in place rather than creating a duplicate row).
    existing = await db.execute(
        select(DocumentRecord).where(
            DocumentRecord.user_id == user.id,
            DocumentRecord.document_id == result.document_id,
        )
    )
    record = existing.scalar_one_or_none()

    if record is None:
        record = DocumentRecord(
            document_id=result.document_id,
            user_id=user.id,
            filename=original_name,
            chunks_total=result.chunks_total,
            namespace=user.namespace,
        )
        db.add(record)
    else:
        record.filename     = original_name
        record.chunks_total = result.chunks_total

    await db.commit()

    return IngestResponse(
        document_id=result.document_id,
        filename=original_name,
        chunks_total=result.chunks_total,
        vectors_upserted=result.vectors_upserted,
        namespace=result.namespace,
    )


@router.post(
    "/text",
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest raw text into your private namespace",
)
async def ingest_text(
    body: IngestTextRequest,
    svc:  IngestionService = Depends(get_ingestion_service),
    user: User             = Depends(get_current_user),
    db:   AsyncSession     = Depends(get_db),
) -> IngestResponse:
    result = await svc.ingest_text(
        text=body.text,
        source=body.source,
        namespace=user.namespace,
        metadata={**(body.metadata or {}), "owner_id": user.id},
        document_id=body.document_id,
    )

    existing = await db.execute(
        select(DocumentRecord).where(
            DocumentRecord.user_id == user.id,
            DocumentRecord.document_id == result.document_id,
        )
    )
    record = existing.scalar_one_or_none()
    if record is None:
        db.add(DocumentRecord(
            document_id=result.document_id,
            user_id=user.id,
            filename=body.source,
            chunks_total=result.chunks_total,
            namespace=user.namespace,
        ))
    else:
        record.chunks_total = result.chunks_total
    await db.commit()

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
    summary="Delete one of your documents",
)
async def delete_document(
    document_id: str,
    svc:  IngestionService = Depends(get_ingestion_service),
    user: User             = Depends(get_current_user),
    db:   AsyncSession     = Depends(get_db),
) -> None:
    # Ownership check FIRST — a user must not be able to delete a
    # document_id belonging to someone else just by guessing it.
    owned = await db.execute(
        select(DocumentRecord).where(
            DocumentRecord.user_id == user.id,
            DocumentRecord.document_id == document_id,
        )
    )
    if owned.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found in your library.",
        )

    await svc.delete_document(
        document_id=document_id,
        namespace=user.namespace,
    )

    await db.execute(
        sa_delete(DocumentRecord).where(
            DocumentRecord.user_id == user.id,
            DocumentRecord.document_id == document_id,
        )
    )
    await db.commit()


@router.get(
    "/stats",
    response_model=IndexStatsResponse,
    summary="Pinecone index statistics",
)
async def index_stats(
    pc:   PineconeClient = Depends(get_pinecone_client),
    user: User           = Depends(get_current_user),
) -> IndexStatsResponse:
    stats = await pc.get_stats()
    return IndexStatsResponse(
        total_vectors=stats.total_vectors,
        dimension=stats.dimension,
        namespaces=stats.namespaces,
        index_fullness=stats.index_fullness,
    )