"""
api/routes/documents.py
------------------------
POST   /api/v1/documents/upload     — multipart file upload + ingestion
POST   /api/v1/documents/text       — ingest raw text
DELETE /api/v1/documents/{id}       — delete document chunks
GET    /api/v1/documents/stats      — Pinecone index statistics
"""
from __future__ import annotations
import os, tempfile
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
_ALLOWED = {".pdf", ".docx", ".txt", ".md", ".html", ".htm"}
_MAX_SIZE = 50 * 1024 * 1024

@router.post("/upload", response_model=IngestResponse, status_code=201)
async def upload_document(
    file:      UploadFile  = File(...),
    namespace: str | None  = Form(default=None),
    svc:       IngestionService = Depends(get_ingestion_service),
    _key:      str              = Depends(require_api_key),
) -> IngestResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED:
        raise HTTPException(415, f"Type '{suffix}' not supported. Allowed: {_ALLOWED}")
    content = await file.read()
    if len(content) > _MAX_SIZE:
        raise HTTPException(413, "File exceeds 50 MB limit.")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content); tmp_path = tmp.name
    try:
        r = await svc.ingest_file(tmp_path, namespace=namespace,
                                  metadata={"original_filename": file.filename})
    finally:
        os.unlink(tmp_path)
    return IngestResponse(document_id=r.document_id, filename=r.filename,
                          chunks_total=r.chunks_total, vectors_upserted=r.vectors_upserted,
                          namespace=r.namespace)

@router.post("/text", response_model=IngestResponse, status_code=201)
async def ingest_text(
    body: IngestTextRequest,
    svc:  IngestionService = Depends(get_ingestion_service),
    _key: str              = Depends(require_api_key),
) -> IngestResponse:
    r = await svc.ingest_text(body.text, source=body.source, namespace=body.namespace,
                               metadata=body.metadata, document_id=body.document_id)
    return IngestResponse(document_id=r.document_id, filename=r.filename,
                          chunks_total=r.chunks_total, vectors_upserted=r.vectors_upserted,
                          namespace=r.namespace)

@router.delete("/{document_id}", status_code=204, response_model=None)
async def delete_document(
    document_id: str,
    namespace:   str | None = None,
    svc:         IngestionService = Depends(get_ingestion_service),
    _key:        str = Depends(require_api_key),
) -> None:
    await svc.delete_document(document_id=document_id, namespace=namespace)

@router.get("/stats", response_model=IndexStatsResponse)
async def index_stats(
    pc:   PineconeClient = Depends(get_pinecone_client),
    _key: str            = Depends(require_api_key),
) -> IndexStatsResponse:
    s = await pc.get_stats()
    return IndexStatsResponse(total_vectors=s.total_vectors, dimension=s.dimension,
                              namespaces=s.namespaces, index_fullness=s.index_fullness)
