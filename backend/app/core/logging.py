"""
core/logging.py
---------------
Structured logging for the RAG API.

• Plain text in development (readable in terminals).
• JSON in staging / production (parseable by ELK, CloudWatch, Datadog).
• A `request_id` context variable is automatically injected into every log
  record emitted during a request, enabling end-to-end trace correlation.
• Log level is controlled by the LOG_LEVEL environment variable.
"""

from __future__ import annotations

import logging
import sys
import uuid
from contextvars import ContextVar
from typing import Any

import structlog

# ──────────────────────────────────────────────
# Request-ID context
# ──────────────────────────────────────────────

_request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")


def get_request_id() -> str:
    return _request_id_ctx.get() or "-"


def set_request_id(request_id: str | None = None) -> str:
    rid = request_id or str(uuid.uuid4())
    _request_id_ctx.set(rid)
    return rid


def clear_request_id() -> None:
    _request_id_ctx.set("")


# ──────────────────────────────────────────────
# Structlog processors
# ──────────────────────────────────────────────

def _inject_request_id(
    logger: Any, method: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """Inject the current request-ID into every log record."""
    rid = get_request_id()
    if rid and rid != "-":
        event_dict["request_id"] = rid
    return event_dict


def _drop_color_message(
    logger: Any, method: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """Remove uvicorn's pre-coloured message (keep the plain one)."""
    event_dict.pop("color_message", None)
    return event_dict


# ──────────────────────────────────────────────
# Setup
# ──────────────────────────────────────────────

def setup_logging(log_level: str = "INFO", json_logs: bool = False) -> None:
    """
    Initialise structlog + stdlib logging.

    Call once from `main.py` at application startup:
        from app.core.logging import setup_logging
        from app.core.config import get_settings
        setup_logging(get_settings().log_level, get_settings().log_json)
    """
    level = logging.getLevelName(log_level.upper())

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        _inject_request_id,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        _drop_color_message,
        structlog.processors.StackInfoRenderer(),
    ]

    if json_logs:
        # Production: machine-readable JSON
        renderer = structlog.processors.JSONRenderer()
    else:
        # Development: pretty coloured text
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=shared_processors
        + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(level)

    # Quieten noisy third-party loggers
    for noisy in ("uvicorn", "uvicorn.error", "uvicorn.access",
                  "fastapi", "httpx", "pinecone"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Re-enable uvicorn access logs at INFO so we see request lines
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)


# ──────────────────────────────────────────────
# Public factory
# ──────────────────────────────────────────────

def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """
    Return a bound structlog logger.

    Usage:
        from app.core.logging import get_logger
        logger = get_logger(__name__)

        logger.info("ingestion_started", filename="report.pdf", chunks=42)
        logger.error("pinecone_upsert_failed", error=str(e), index="rag-index")
    """
    return structlog.get_logger(name)


# ──────────────────────────────────────────────
# Middleware helper
# ──────────────────────────────────────────────

class RequestIDMiddleware:
    """
    ASGI middleware that:
      1. Reads `X-Request-ID` from the incoming request header (if present).
      2. Generates a UUID if no header is found.
      3. Injects the ID into the ContextVar so all log calls within the
         request lifecycle include it automatically.
      4. Echoes it back in `X-Request-ID` on the response.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        # Extract or generate request ID
        headers = dict(scope.get("headers", []))
        incoming = headers.get(b"x-request-id", b"").decode()
        rid = set_request_id(incoming or None)

        async def send_with_rid(message: Any) -> None:
            if message["type"] == "http.response.start":
                headers_list = list(message.get("headers", []))
                headers_list.append((b"x-request-id", rid.encode()))
                message = {**message, "headers": headers_list}
            await send(message)

        try:
            await self.app(scope, receive, send_with_rid)
        finally:
            clear_request_id()
