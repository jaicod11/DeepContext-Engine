"""
core/security.py
----------------
API-key authentication and per-IP / per-key rate limiting.

• The API key is read from the X-API-Key request header (configurable).
• If `settings.api_keys` is empty AND the environment is not production,
  authentication is **skipped** — handy for local development.
• Rate limiting uses an in-memory sliding window (via a simple dict).
  Swap for Redis-backed limits in multi-worker / multi-pod deployments.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from collections import defaultdict, deque
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import APIKeyHeader

from app.core.config import Environment, Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ──────────────────────────────────────────────
# FastAPI security scheme (shows up in Swagger)
# ──────────────────────────────────────────────

_api_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)

# ──────────────────────────────────────────────
# In-memory rate limiter  (replace with Redis in prod)
# ──────────────────────────────────────────────

# key  → deque of Unix timestamps (one entry per request)
_rate_limit_store: dict[str, deque[float]] = defaultdict(deque)


def _check_rate_limit(identifier: str, limit: int, window_seconds: int = 60) -> None:
    """
    Sliding-window rate limiter.

    Raises HTTP 429 if `identifier` has exceeded `limit` requests
    within the last `window_seconds`.
    """
    now = time.monotonic()
    cutoff = now - window_seconds
    q = _rate_limit_store[identifier]

    # Evict timestamps outside the current window
    while q and q[0] < cutoff:
        q.popleft()

    if len(q) >= limit:
        retry_after = int(window_seconds - (now - q[0])) + 1
        logger.warning(
            "rate_limit_exceeded",
            identifier=identifier,
            limit=limit,
            retry_after=retry_after,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Retry after {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    q.append(now)


# ──────────────────────────────────────────────
# Key validation
# ──────────────────────────────────────────────

def _constant_time_key_check(provided: str, valid_keys: list[str]) -> bool:
    """
    Timing-safe comparison against all valid keys.
    Returns True if `provided` matches any key in the list.
    """
    provided_bytes = provided.encode()
    result = False
    for key in valid_keys:
        # Compare hashes, not raw strings, to avoid partial-match leakage
        h1 = hashlib.sha256(provided_bytes).digest()
        h2 = hashlib.sha256(key.encode()).digest()
        if hmac.compare_digest(h1, h2):
            result = True
    return result


def _client_identifier(request: Request) -> str:
    """Best-effort client IP extraction (proxy-aware)."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


# ──────────────────────────────────────────────
# FastAPI dependency
# ──────────────────────────────────────────────

async def require_api_key(
    request: Request,
    raw_key: Annotated[str | None, Security(_api_key_scheme)] = None,
    settings: Settings = Depends(get_settings),
) -> str:
    """
    FastAPI dependency that:
      1. Skips auth if api_keys is empty AND environment != production.
      2. Returns 401 if the header is missing or blank.
      3. Returns 403 if the key is invalid.
      4. Enforces per-key rate limiting.
      5. Returns the validated key (useful for audit logging).

    Usage:
        @router.post("/query")
        async def query(
            body: QueryRequest,
            api_key: str = Depends(require_api_key),
        ):
            ...
    """
    client_id = _client_identifier(request)

    # ── Dev bypass ──────────────────────────
    if not settings.api_keys:
        if settings.environment == Environment.PRODUCTION:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfiguration: no API keys configured in production.",
            )
        logger.debug("auth_skipped_dev_mode", client=client_id)
        _check_rate_limit(client_id, settings.rate_limit_per_minute)
        return "dev-bypass"

    # ── Missing key ──────────────────────────
    if not raw_key:
        logger.warning("auth_missing_key", client=client_id, path=request.url.path)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key. Provide it in the X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    # ── Invalid key ──────────────────────────
    if not _constant_time_key_check(raw_key, settings.api_keys):
        logger.warning(
            "auth_invalid_key",
            client=client_id,
            key_prefix=raw_key[:6] + "…",
            path=request.url.path,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key.",
        )

    # ── Rate limit per key ───────────────────
    key_id = hashlib.sha256(raw_key.encode()).hexdigest()[:12]
    _check_rate_limit(key_id, settings.rate_limit_per_minute)

    logger.debug("auth_ok", client=client_id, key_prefix=raw_key[:6] + "…")
    return raw_key


# ──────────────────────────────────────────────
# Optional: public-route guard (no auth needed)
# ──────────────────────────────────────────────

async def public_rate_limit(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> None:
    """
    Apply rate limiting to public endpoints (e.g. /health) without
    requiring an API key.
    """
    client_id = _client_identifier(request)
    # Public routes get a more generous limit
    _check_rate_limit(client_id, limit=settings.rate_limit_per_minute * 2)
