"""
services/ingestion_service.py
------------------------------
Full document ingestion pipeline:
  load → split → embed → upsert to Pinecone

Supports PDF, DOCX, TXT, and HTML files.
Handles re-ingestion cleanly by deleting old chunks before upserting fresh ones.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.vectorstore.embeddings import CachedEmbedder, get_embedder
from app.vectorstore.pinecone_client import PineconeClient, VectorRecord, get_pinecone_client

logger = get_logger(__name__)


@dataclass
class IngestionResult:
    document_id:   str
    filename:      str
    chunks_total:  int
    vectors_upserted: int
    namespace:     str


class IngestionService:
    def __init__(
        self,
        pinecone: PineconeClient  | None = None,
        embedder: CachedEmbedder  | None = None,
        settings: Settings        | None = None,
    ) -> None:
        self._pc       = pinecone or get_pinecone_client()
        self._embedder = embedder or get_embedder()
        self._settings = settings or get_settings()
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=self._settings.chunk_size,
            chunk_overlap=self._settings.chunk_overlap,
            separators=self._settings.splitter_separators,
        )

    # ─────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────

    async def ingest_file(
        self,
        file_path:   str | Path,
        namespace:   str | None = None,
        metadata:    dict | None = None,
        document_id: str | None = None,
    ) -> IngestionResult:
        """
        Ingest a document from the filesystem.

        If `document_id` is provided and chunks already exist in Pinecone
        (identified by metadata.document_id), they are deleted first —
        enabling clean re-ingestion without duplicates.
        """
        path   = Path(file_path)
        ns     = namespace or self._settings.pinecone_namespace
        doc_id = document_id or self._file_hash(path)

        logger.info(
            "ingestion_started",
            file=path.name,
            document_id=doc_id,
            namespace=ns,
        )

        # 1. Load raw text
        text = await self._load_file(path)

        # 2. Split into chunks
        chunks = self._splitter.split_text(text)
        logger.debug("ingestion_split", file=path.name, chunks=len(chunks))

        # 3. Delete stale vectors if re-ingesting
        await self._pc.delete_by_filter(
            filter={"document_id": {"$eq": doc_id}},
            namespace=ns,
        )

        # 4. Embed all chunks
        vectors = await self._embedder.embed_documents(chunks)

        # 5. Build VectorRecord list
        base_meta = {
            "document_id":  doc_id,
            "source":       path.name,
            "total_chunks": len(chunks),
            **(metadata or {}),
        }
        records = [
            VectorRecord(
                vector_id=f"{doc_id}-{i}",
                values=vec,
                metadata={
                    **base_meta,
                    "text":        chunk,
                    "chunk_index": i,
                },
            )
            for i, (chunk, vec) in enumerate(zip(chunks, vectors))
        ]

        # 6. Upsert to Pinecone
        upserted = await self._pc.upsert(records, namespace=ns)

        logger.info(
            "ingestion_complete",
            file=path.name,
            document_id=doc_id,
            chunks=len(chunks),
            upserted=upserted,
            namespace=ns,
        )
        return IngestionResult(
            document_id=doc_id,
            filename=path.name,
            chunks_total=len(chunks),
            vectors_upserted=upserted,
            namespace=ns,
        )

    async def ingest_text(
        self,
        text:        str,
        source:      str = "inline",
        namespace:   str | None = None,
        metadata:    dict | None = None,
        document_id: str | None = None,
    ) -> IngestionResult:
        """Ingest raw text (no file path needed)."""
        ns     = namespace or self._settings.pinecone_namespace
        doc_id = document_id or hashlib.sha256(text.encode()).hexdigest()[:16]

        chunks  = self._splitter.split_text(text)
        vectors = await self._embedder.embed_documents(chunks)

        await self._pc.delete_by_filter(
            filter={"document_id": {"$eq": doc_id}},
            namespace=ns,
        )

        records = [
            VectorRecord(
                vector_id=f"{doc_id}-{i}",
                values=vec,
                metadata={
                    "document_id":  doc_id,
                    "source":       source,
                    "text":         chunk,
                    "chunk_index":  i,
                    "total_chunks": len(chunks),
                    **(metadata or {}),
                },
            )
            for i, (chunk, vec) in enumerate(zip(chunks, vectors))
        ]

        upserted = await self._pc.upsert(records, namespace=ns)
        return IngestionResult(
            document_id=doc_id,
            filename=source,
            chunks_total=len(chunks),
            vectors_upserted=upserted,
            namespace=ns,
        )

    async def delete_document(
        self,
        document_id: str,
        namespace:   str | None = None,
    ) -> None:
        """Remove all Pinecone vectors belonging to a document."""
        ns = namespace or self._settings.pinecone_namespace
        await self._pc.delete_by_filter(
            filter={"document_id": {"$eq": document_id}},
            namespace=ns,
        )
        logger.info("document_deleted", document_id=document_id, namespace=ns)

    # ─────────────────────────────────────────
    # File loaders
    # ─────────────────────────────────────────

    async def _load_file(self, path: Path) -> str:
        suffix = path.suffix.lower()
        loaders = {
            ".pdf":  self._load_pdf,
            ".docx": self._load_docx,
            ".txt":  self._load_text,
            ".md":   self._load_text,
            ".html": self._load_html,
            ".htm":  self._load_html,
        }
        loader = loaders.get(suffix)
        if loader is None:
            raise ValueError(
                f"Unsupported file type: {suffix}. "
                f"Supported: {list(loaders.keys())}"
            )
        return await loader(path)

    @staticmethod
    async def _load_pdf(path: Path) -> str:
        import asyncio
        from pypdf import PdfReader

        def _read() -> str:
            reader = PdfReader(str(path))
            return "\n\n".join(
                page.extract_text() or "" for page in reader.pages
            )

        return await asyncio.to_thread(_read)

    @staticmethod
    async def _load_docx(path: Path) -> str:
        import asyncio
        from docx import Document

        def _read() -> str:
            doc = Document(str(path))
            return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())

        return await asyncio.to_thread(_read)

    @staticmethod
    async def _load_text(path: Path) -> str:
        import aiofiles
        async with aiofiles.open(path, encoding="utf-8", errors="replace") as f:
            return await f.read()

    @staticmethod
    async def _load_html(path: Path) -> str:
        import asyncio
        import aiofiles
        from html.parser import HTMLParser

        class _Stripper(HTMLParser):
            def __init__(self) -> None:
                super().__init__()
                self._parts: list[str] = []
            def handle_data(self, data: str) -> None:
                stripped = data.strip()
                if stripped:
                    self._parts.append(stripped)
            def get_text(self) -> str:
                return " ".join(self._parts)

        async with aiofiles.open(path, encoding="utf-8", errors="replace") as f:
            html = await f.read()

        def _strip(html: str) -> str:
            p = _Stripper()
            p.feed(html)
            return p.get_text()

        return await asyncio.to_thread(_strip, html)

    # ─────────────────────────────────────────
    # Utilities
    # ─────────────────────────────────────────

    @staticmethod
    def _file_hash(path: Path) -> str:
        """Stable document ID derived from file content SHA-256."""
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()[:16]


# ─────────────────────────────────────────────
# Singleton
# ─────────────────────────────────────────────

_ingestion_instance: IngestionService | None = None


def get_ingestion_service() -> IngestionService:
    global _ingestion_instance
    if _ingestion_instance is None:
        _ingestion_instance = IngestionService()
    return _ingestion_instance
