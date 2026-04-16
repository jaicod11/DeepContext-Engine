"""
models/__init__.py
------------------
Re-export all public schemas from one place.

Usage:
    from app.models import QueryRequest, QueryResponse, IngestResponse
"""

from app.models.document import (
    DeleteDocumentResponse,
    DocumentRecord,
    DocumentStatus,
    IndexStatsResponse,
    IngestResponse,
    IngestTextRequest,
    SupportedFileType,
)
from app.models.query import (
    ChatMessage,
    ConversationalQueryRequest,
    HealthResponse,
    QueryRequest,
    QueryResponse,
    SourceChunk,
)

__all__ = [
    # document
    "IngestTextRequest",
    "IngestResponse",
    "DocumentRecord",
    "DocumentStatus",
    "DeleteDocumentResponse",
    "IndexStatsResponse",
    "SupportedFileType",
    # query
    "QueryRequest",
    "ConversationalQueryRequest",
    "ChatMessage",
    "QueryResponse",
    "SourceChunk",
    "HealthResponse",
]
