"""
tests/conftest.py
------------------
Shared pytest fixtures for unit and integration tests.

Key design choices:
  • All external I/O (Pinecone, Gemini, Redis) is mocked by default so the
    unit suite runs offline with no credentials.
  • Integration fixtures use environment variables and are skipped when
    INTEGRATION_TESTS=1 is not set.
  • The FastAPI TestClient is created once per test session for speed.
"""

from __future__ import annotations

import os
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient


# ──────────────────────────────────────────────
# Environment patches (applied before app import)
# ──────────────────────────────────────────────

os.environ.setdefault("PINECONE_API_KEY",  "test-pinecone-key")
os.environ.setdefault("GEMINI_API_KEY",    "test-gemini-key")
os.environ.setdefault("ENVIRONMENT",       "development")
os.environ.setdefault("API_KEYS",          "test-key-abc123")
os.environ.setdefault("REDIS_URL",         "redis://localhost:6379/15")  # test DB


# ──────────────────────────────────────────────
# Settings fixture
# ──────────────────────────────────────────────

@pytest.fixture(scope="session")
def settings():
    from app.core.config import get_settings
    get_settings.cache_clear()
    return get_settings()


# ──────────────────────────────────────────────
# Mock Pinecone
# ──────────────────────────────────────────────

@pytest.fixture
def mock_pinecone_client():
    """Returns a fully mocked PineconeClient."""
    from app.vectorstore.pinecone_client import QueryResult

    client             = MagicMock()
    client.is_ready    = True

    # Default query returns two plausible hits
    client.query       = AsyncMock(return_value=[
        QueryResult(
            vector_id="vec-001",
            score=0.91,
            metadata={
                "text":        "Payment terms require invoices within 30 days of delivery.",
                "source":      "contract-2024.pdf",
                "document_id": "doc-abc",
                "chunk_index": 0,
            },
        ),
        QueryResult(
            vector_id="vec-002",
            score=0.83,
            metadata={
                "text":        "Late payments incur a 1.5% monthly interest charge.",
                "source":      "contract-2024.pdf",
                "document_id": "doc-abc",
                "chunk_index": 1,
            },
        ),
    ])
    client.upsert      = AsyncMock(return_value=4)
    client.delete_by_filter = AsyncMock(return_value=None)
    client.delete_by_ids    = AsyncMock(return_value=None)
    client.get_stats   = AsyncMock(return_value=MagicMock(
        total_vectors=100, dimension=768,
        namespaces={"default": 100}, index_fullness=0.001,
    ))
    client.health_check = AsyncMock(return_value={
        "status": "ok", "index": "rag-index", "total_vectors": 100,
    })
    return client


# ──────────────────────────────────────────────
# Mock Embedder
# ──────────────────────────────────────────────

@pytest.fixture
def mock_embedder():
    """Returns a mocked CachedEmbedder that produces deterministic 768-dim vectors."""
    embedder = MagicMock()
    embedder.dimension = 768
    embedder.embed_query     = AsyncMock(return_value=[0.1] * 768)
    embedder.embed_documents = AsyncMock(return_value=[[0.1] * 768, [0.2] * 768])
    return embedder


# ──────────────────────────────────────────────
# Mock Reranker
# ──────────────────────────────────────────────

@pytest.fixture
def mock_reranker():
    """Returns a mocked RerankerService that passes candidates through unchanged."""
    from app.services.reranker_service import RankedChunk

    reranker = MagicMock()
    reranker.rerank = AsyncMock(return_value=[
        RankedChunk(
            text="Payment terms require invoices within 30 days.",
            source="contract-2024.pdf",
            score=0.95,
            vector_id="vec-001",
            metadata={"document_id": "doc-abc"},
        ),
    ])
    reranker.warmup = AsyncMock(return_value=None)
    return reranker


# ──────────────────────────────────────────────
# Mock LLM
# ──────────────────────────────────────────────

@pytest.fixture
def mock_llm():
    """Returns a mocked LLMService with a canned answer."""

    async def _fake_stream(prompt: str):
        for token in ["Invoices ", "are due ", "within 30 days [SOURCE 1]."]:
            yield token

    llm = MagicMock()
    llm.generate = AsyncMock(
        return_value="Invoices are due within 30 days of delivery [SOURCE 1]."
    )
    llm.stream   = _fake_stream

    langchain_mock = MagicMock()
    langchain_mock.ainvoke = AsyncMock(return_value=MagicMock(
        content="Invoices are due within 30 days [SOURCE 1]."
    ))
    llm.get_langchain_llm = MagicMock(return_value=langchain_mock)
    return llm


# ──────────────────────────────────────────────
# FastAPI test app
# ──────────────────────────────────────────────

@pytest.fixture(scope="session")
def app(settings):
    """Create the FastAPI app with all external deps patched."""
    with (
        patch("app.vectorstore.pinecone_client._client_instance", MagicMock(is_ready=True)),
        patch("app.vectorstore.embeddings._embedder_instance",    MagicMock(dimension=768)),
        patch("app.services.reranker_service._reranker_instance", MagicMock()),
        patch("app.services.llm_service._llm_instance",          MagicMock()),
        patch("app.main.validate_embedding_dimension",            AsyncMock()),
        patch("app.main.get_pinecone_client"),
    ):
        from app.main import create_app
        application = create_app()
        return application


@pytest.fixture(scope="session")
def client(app) -> TestClient:
    """Synchronous test client (for simple endpoint tests)."""
    return TestClient(app, raise_server_exceptions=True)


@pytest_asyncio.fixture
async def async_client(app) -> AsyncGenerator[AsyncClient, None]:
    """Async test client for testing streaming endpoints."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


# ──────────────────────────────────────────────
# Auth header helper
# ──────────────────────────────────────────────

@pytest.fixture
def auth_headers(client) -> dict[str, str]:
    """
    Bearer token for a real test account.

    These integration tests were written against the pre-auth shared-secret
    scheme and sent {"X-API-Key": ...}, which every user-facing route now
    rejects with 401 — the backend authenticates users individually via JWT.
    Registering a throwaway account here keeps the tests exercising the real
    auth path instead of a header the app no longer honours.
    """
    import uuid

    email = f"pytest_{uuid.uuid4().hex[:10]}@example.com"
    password = "PytestPass123!"

    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "pytest"},
    )
    if resp.status_code >= 400:
        # Account already exists (re-run against a persistent dev DB)
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
        )
    resp.raise_for_status()
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ──────────────────────────────────────────────
# Integration test guard
# ──────────────────────────────────────────────

def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: mark test as requiring live Pinecone + Gemini credentials",
    )


def pytest_collection_modifyitems(config, items):
    if not os.getenv("INTEGRATION_TESTS"):
        skip = pytest.mark.skip(reason="Set INTEGRATION_TESTS=1 to run")
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip)
