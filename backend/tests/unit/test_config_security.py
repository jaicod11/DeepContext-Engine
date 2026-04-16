"""
tests/unit/test_config_security.py
------------------------------------
Unit tests for:
  • Settings validation (field validators, production guards)
  • API key authentication logic
  • Rate limiter sliding-window behaviour
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException


# ──────────────────────────────────────────────
# Settings
# ──────────────────────────────────────────────

class TestSettings:
    def test_defaults_are_valid(self, settings):
        assert settings.pinecone_index_name == "rag-index"
        assert settings.chunk_overlap < settings.chunk_size
        assert settings.reranker_top_n <= settings.retrieval_top_k

    def test_api_keys_parsed_from_comma_string(self):
        from app.core.config import Settings
        s = Settings(
            pinecone_api_key="key",
            api_keys="abc,def, ghi ",  # type: ignore[arg-type]
        )
        assert s.api_keys == ["abc", "def", "ghi"]

    def test_chunk_overlap_must_be_less_than_chunk_size(self):
        from app.core.config import Settings
        with pytest.raises(ValueError, match="chunk_overlap"):
            Settings(
                pinecone_api_key="key",
                chunk_size=100,
                chunk_overlap=100,
            )

    def test_reranker_top_n_must_not_exceed_top_k(self):
        from app.core.config import Settings
        with pytest.raises(ValueError, match="reranker_top_n"):
            Settings(
                pinecone_api_key="key",
                retrieval_top_k=5,
                reranker_top_n=10,
            )

    def test_production_guard_requires_api_keys(self):
        from app.core.config import Environment, Settings
        with pytest.raises(ValueError, match="api_keys must not be empty"):
            Settings(
                pinecone_api_key="key",
                environment=Environment.PRODUCTION,
                api_keys=[],
                debug=False,
                reload=False,
            )

    def test_redacted_dict_masks_sensitive_fields(self, settings):
        d = settings.redacted_dict()
        assert d["pinecone_api_key"] == "***REDACTED***"
        assert d["gemini_api_key"]   == "***REDACTED***"

    def test_is_production_property(self):
        from app.core.config import Environment, Settings
        s = Settings(
            pinecone_api_key="key",
            environment=Environment.PRODUCTION,
            api_keys=["abc"],
            debug=False,
            reload=False,
        )
        assert s.is_production is True
        assert s.is_development is False


# ──────────────────────────────────────────────
# Security — key validation
# ──────────────────────────────────────────────

class TestSecurity:
    def test_constant_time_check_valid_key(self):
        from app.core.security import _constant_time_key_check
        assert _constant_time_key_check("secret", ["secret"]) is True

    def test_constant_time_check_invalid_key(self):
        from app.core.security import _constant_time_key_check
        assert _constant_time_key_check("wrong", ["secret"]) is False

    def test_constant_time_check_one_of_many(self):
        from app.core.security import _constant_time_key_check
        assert _constant_time_key_check("key2", ["key1", "key2", "key3"]) is True

    def test_missing_key_raises_401(self, client, auth_headers):
        # Hit a protected route without auth
        resp = client.post("/api/v1/query", json={"question": "test"})
        assert resp.status_code in (401, 403, 422)  # depends on dev bypass

    def test_invalid_key_raises_403(self, client):
        resp = client.post(
            "/api/v1/query",
            json={"question": "test"},
            headers={"X-API-Key": "definitely-wrong"},
        )
        # In dev mode with api_keys set, this should be 403
        assert resp.status_code in (401, 403)


# ──────────────────────────────────────────────
# Rate limiter
# ──────────────────────────────────────────────

class TestRateLimiter:
    def test_allows_requests_within_limit(self):
        from app.core.security import _check_rate_limit, _rate_limit_store
        _rate_limit_store.clear()
        for _ in range(5):
            _check_rate_limit("test-id", limit=10)  # should not raise

    def test_blocks_when_limit_exceeded(self):
        from app.core.security import _check_rate_limit, _rate_limit_store
        _rate_limit_store.clear()
        for _ in range(10):
            _check_rate_limit("block-test", limit=10)
        with pytest.raises(HTTPException) as exc_info:
            _check_rate_limit("block-test", limit=10)
        assert exc_info.value.status_code == 429

    def test_window_resets_after_expiry(self):
        from collections import deque
        from app.core.security import _check_rate_limit, _rate_limit_store
        # Inject old timestamps outside the window
        key = "window-test"
        _rate_limit_store[key] = deque([time.monotonic() - 120] * 10)
        # Should not raise — all timestamps are outside the 60s window
        _check_rate_limit(key, limit=5, window_seconds=60)
