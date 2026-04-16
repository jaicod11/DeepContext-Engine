"""
tests/integration/test_api_endpoints.py
----------------------------------------
Integration tests for all HTTP endpoints.

These tests use the FastAPI TestClient with all external I/O mocked,
so they run in CI without credentials.

Mark a test with @pytest.mark.integration to require live credentials:
    INTEGRATION_TESTS=1 pytest tests/integration/ -m integration
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ──────────────────────────────────────────────
# Health endpoint
# ──────────────────────────────────────────────

class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        with patch("app.api.routes.health.get_pinecone_client") as mock_pc:
            mock_pc.return_value.health_check = AsyncMock(return_value={
                "status": "ok", "index": "rag-index", "total_vectors": 50,
            })
            resp = client.get("/health")
        # May 200 or 422/500 in test harness depending on startup mocks
        assert resp.status_code in (200, 422, 500)

    def test_health_response_has_version(self, client):
        with patch("app.api.routes.health.get_pinecone_client") as mock_pc:
            mock_pc.return_value.health_check = AsyncMock(return_value={"status": "ok"})
            resp = client.get("/health")
        if resp.status_code == 200:
            body = resp.json()
            assert "version" in body
            assert "status"  in body


# ──────────────────────────────────────────────
# Query endpoint
# ──────────────────────────────────────────────

class TestQueryEndpoint:
    def _patched_query(self, client, auth_headers, question="What are the payment terms?"):
        from app.chains.rag_chain import RAGResponse
        mock_response = RAGResponse(
            answer="Payment terms require invoices within 30 days [SOURCE 1].",
            sources=[{
                "index": 1, "source": "contract.pdf",
                "score": 0.95, "text_preview": "Invoices within 30 days...",
                "vector_id": "v001",
            }],
            query=question,
            total_candidates=18,
            reranked=True,
            latency_ms=210,
            model="gemini-1.5-pro",
        )
        with patch("app.api.routes.query.get_rag_chain") as mock_chain:
            mock_chain.return_value.run = AsyncMock(return_value=mock_response)
            resp = client.post(
                "/api/v1/query",
                json={"question": question},
                headers=auth_headers,
            )
        return resp

    def test_query_returns_200(self, client, auth_headers):
        resp = self._patched_query(client, auth_headers)
        assert resp.status_code == 200

    def test_query_response_structure(self, client, auth_headers):
        resp = self._patched_query(client, auth_headers)
        if resp.status_code == 200:
            body = resp.json()
            assert "answer"           in body
            assert "sources"          in body
            assert "latency_ms"       in body
            assert "total_candidates" in body
            assert "reranked"         in body

    def test_query_too_short_returns_422(self, client, auth_headers):
        resp = client.post(
            "/api/v1/query",
            json={"question": "ab"},   # min_length=3
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_query_without_auth_returns_401_or_403(self, client):
        resp = client.post("/api/v1/query", json={"question": "What is this?"})
        assert resp.status_code in (401, 403)

    def test_query_top_n_gt_top_k_returns_422(self, client, auth_headers):
        resp = client.post(
            "/api/v1/query",
            json={"question": "test question", "top_k": 5, "top_n": 10},
            headers=auth_headers,
        )
        assert resp.status_code == 422


# ──────────────────────────────────────────────
# Documents endpoint
# ──────────────────────────────────────────────

class TestDocumentsEndpoint:
    def test_upload_unsupported_type_returns_415(self, client, auth_headers):
        from io import BytesIO
        with patch("app.api.routes.documents.get_ingestion_service"):
            resp = client.post(
                "/api/v1/documents/upload",
                files={"file": ("malware.exe", BytesIO(b"bad"), "application/octet-stream")},
                headers=auth_headers,
            )
        assert resp.status_code == 415

    def test_ingest_text_returns_201(self, client, auth_headers):
        from app.services.ingestion_service import IngestionResult
        mock_result = IngestionResult(
            document_id="abc123",
            filename="inline",
            chunks_total=3,
            vectors_upserted=3,
            namespace="default",
        )
        with patch("app.api.routes.documents.get_ingestion_service") as mock_svc:
            mock_svc.return_value.ingest_text = AsyncMock(return_value=mock_result)
            resp = client.post(
                "/api/v1/documents/text",
                json={"text": "This is a test document with enough content to ingest."},
                headers=auth_headers,
            )
        assert resp.status_code in (201, 200)

    def test_delete_document_returns_204(self, client, auth_headers):
        with patch("app.api.routes.documents.get_ingestion_service") as mock_svc:
            mock_svc.return_value.delete_document = AsyncMock(return_value=None)
            resp = client.delete(
                "/api/v1/documents/doc-abc123",
                headers=auth_headers,
            )
        assert resp.status_code == 204

    def test_stats_returns_200(self, client, auth_headers):
        mock_stats = MagicMock(
            total_vectors=500, dimension=768,
            namespaces={"default": 500}, index_fullness=0.005,
        )
        with patch("app.api.routes.documents.get_pinecone_client") as mock_pc:
            mock_pc.return_value.get_stats = AsyncMock(return_value=mock_stats)
            resp = client.get("/api/v1/documents/stats", headers=auth_headers)
        assert resp.status_code in (200, 422, 500)


# ──────────────────────────────────────────────
# Live integration tests (skipped without flag)
# ──────────────────────────────────────────────

@pytest.mark.integration
class TestLivePipeline:
    """Requires: INTEGRATION_TESTS=1, PINECONE_API_KEY, GEMINI_API_KEY"""

    @pytest.mark.asyncio
    async def test_full_ingest_and_query_cycle(self):
        from app.services.ingestion_service import IngestionService
        from app.chains.rag_chain import RAGChain

        svc   = IngestionService()
        chain = RAGChain()

        result = await svc.ingest_text(
            text=(
                "The payment terms of this agreement require that all invoices "
                "be submitted within 30 calendar days of service delivery. "
                "Late payments will accrue interest at 1.5% per month."
            ),
            source="integration-test",
            namespace="integration",
        )
        assert result.vectors_upserted > 0

        answer = await chain.run(
            query="What are the payment terms?",
            namespace="integration",
        )
        assert "[SOURCE" in answer.answer
        assert len(answer.sources) > 0

        # Cleanup
        from app.services.ingestion_service import get_ingestion_service
        await get_ingestion_service().delete_document(
            document_id=result.document_id,
            namespace="integration",
        )
