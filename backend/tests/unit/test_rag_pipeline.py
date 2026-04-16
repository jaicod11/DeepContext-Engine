"""
tests/unit/test_rag_pipeline.py
---------------------------------
Unit tests for:
  • RetrievalService — two-stage pipeline wiring
  • RerankerService  — reranking logic and bypass
  • RAGChain         — full chain response structure
  • prompt_templates — context formatting
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


# ──────────────────────────────────────────────
# prompt_templates
# ──────────────────────────────────────────────

class TestPromptTemplates:
    def test_format_context_numbers_sources(self):
        from app.chains.prompt_templates import format_context
        chunks = [
            {"text": "First chunk.", "source": "doc1.pdf", "score": 0.9},
            {"text": "Second chunk.", "source": "doc2.pdf", "score": 0.8},
        ]
        ctx = format_context(chunks)
        assert "[SOURCE 1]" in ctx
        assert "[SOURCE 2]" in ctx
        assert "doc1.pdf" in ctx
        assert "First chunk." in ctx

    def test_format_context_includes_score(self):
        from app.chains.prompt_templates import format_context
        chunks = [{"text": "text", "source": "src", "score": 0.755}]
        ctx = format_context(chunks)
        assert "0.755" in ctx

    def test_format_context_empty_list(self):
        from app.chains.prompt_templates import format_context
        assert format_context([]) == ""

    def test_rag_qa_prompt_has_required_variables(self):
        from app.chains.prompt_templates import RAG_QA_PROMPT
        variables = RAG_QA_PROMPT.input_variables
        assert "context"  in variables
        assert "question" in variables


# ──────────────────────────────────────────────
# RerankerService
# ──────────────────────────────────────────────

class TestRerankerService:
    @pytest.fixture
    def disabled_reranker(self, settings):
        from app.services.reranker_service import RerankerService
        s = MagicMock()
        s.reranker_enabled = False
        s.reranker_top_n   = 3
        return RerankerService(settings=s)

    @pytest.mark.asyncio
    async def test_disabled_reranker_passes_through(self, disabled_reranker):
        candidates = [
            {"text": f"chunk {i}", "source": "doc.pdf",
             "score": 0.9 - i * 0.1, "vector_id": f"v{i}", "metadata": {}}
            for i in range(5)
        ]
        results = await disabled_reranker.rerank("test query", candidates, top_n=3)
        assert len(results) == 3
        assert results[0].text == "chunk 0"

    @pytest.mark.asyncio
    async def test_disabled_reranker_empty_candidates(self, disabled_reranker):
        results = await disabled_reranker.rerank("test", [], top_n=5)
        assert results == []


# ──────────────────────────────────────────────
# RetrievalService
# ──────────────────────────────────────────────

class TestRetrievalService:
    @pytest.fixture
    def retrieval_service(self, mock_pinecone_client, mock_embedder, mock_reranker, settings):
        from app.services.retrieval_service import RetrievalService
        return RetrievalService(
            pinecone=mock_pinecone_client,
            embedder=mock_embedder,
            reranker=mock_reranker,
            settings=settings,
        )

    @pytest.mark.asyncio
    async def test_retrieve_returns_ranked_chunks(self, retrieval_service):
        result = await retrieval_service.retrieve("What are the payment terms?")
        assert len(result.chunks) >= 1
        assert result.query_text == "What are the payment terms?"
        assert result.total_candidates >= 1

    @pytest.mark.asyncio
    async def test_retrieve_calls_embed_query(self, retrieval_service, mock_embedder):
        await retrieval_service.retrieve("test query")
        mock_embedder.embed_query.assert_awaited_once_with("test query")

    @pytest.mark.asyncio
    async def test_retrieve_calls_pinecone_query(self, retrieval_service, mock_pinecone_client):
        await retrieval_service.retrieve("test query")
        mock_pinecone_client.query.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_retrieve_calls_reranker(self, retrieval_service, mock_reranker):
        await retrieval_service.retrieve("test query")
        mock_reranker.rerank.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_retrieve_empty_pinecone_results(
        self, mock_pinecone_client, mock_embedder, mock_reranker, settings
    ):
        from app.services.retrieval_service import RetrievalService
        mock_pinecone_client.query = AsyncMock(return_value=[])
        svc = RetrievalService(
            pinecone=mock_pinecone_client,
            embedder=mock_embedder,
            reranker=mock_reranker,
            settings=settings,
        )
        result = await svc.retrieve("unanswerable question")
        assert result.chunks == []
        assert result.total_candidates == 0
        mock_reranker.rerank.assert_not_awaited()


# ──────────────────────────────────────────────
# RAGChain
# ──────────────────────────────────────────────

class TestRAGChain:
    @pytest.fixture
    def rag_chain(self, mock_pinecone_client, mock_embedder, mock_reranker, mock_llm, settings):
        from app.chains.rag_chain import RAGChain
        from app.services.retrieval_service import RetrievalService
        retrieval = RetrievalService(
            pinecone=mock_pinecone_client,
            embedder=mock_embedder,
            reranker=mock_reranker,
            settings=settings,
        )
        return RAGChain(retrieval=retrieval, llm=mock_llm, settings=settings)

    @pytest.mark.asyncio
    async def test_run_returns_rag_response(self, rag_chain):
        from app.chains.rag_chain import RAGResponse
        result = await rag_chain.run("What are the payment terms?")
        assert isinstance(result, RAGResponse)
        assert len(result.answer) > 0
        assert isinstance(result.sources, list)
        assert result.latency_ms > 0

    @pytest.mark.asyncio
    async def test_run_no_chunks_returns_fallback(
        self, mock_pinecone_client, mock_embedder, mock_reranker, mock_llm, settings
    ):
        from app.chains.rag_chain import RAGChain
        from app.services.retrieval_service import RetrievalService
        mock_pinecone_client.query = AsyncMock(return_value=[])
        retrieval = RetrievalService(
            pinecone=mock_pinecone_client,
            embedder=mock_embedder,
            reranker=mock_reranker,
            settings=settings,
        )
        chain = RAGChain(retrieval=retrieval, llm=mock_llm, settings=settings)
        result = await chain.run("question with no matching documents")
        assert "do not contain" in result.answer.lower()
        assert result.sources == []

    @pytest.mark.asyncio
    async def test_stream_yields_done_frame(self, rag_chain):
        frames = []
        async for frame in rag_chain.stream("What are the payment terms?"):
            frames.append(frame)
        assert any("[DONE]" in f for f in frames)
        assert any("[SOURCES]" in f for f in frames)

    @pytest.mark.asyncio
    async def test_run_sources_have_required_fields(self, rag_chain):
        result = await rag_chain.run("test")
        for src in result.sources:
            assert "index"        in src
            assert "source"       in src
            assert "score"        in src
            assert "text_preview" in src
            assert "vector_id"    in src
