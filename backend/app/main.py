from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import init_db
from app.core.logging import RequestIDMiddleware, get_logger, setup_logging
from app.vectorstore.embeddings import get_embedder, validate_embedding_dimension
from app.vectorstore.pinecone_client import get_pinecone_client

settings = get_settings()

setup_logging(log_level=settings.log_level, json_logs=settings.log_json)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "rag_api_starting",
        **{k: v for k, v in settings.redacted_dict().items()
           if k in {"environment", "llm_provider", "embedding_provider",
                    "pinecone_index_name", "log_level"}},
    )

    # 1. Create user/document tables if they don't exist.
    #    Fast + local, so it runs first — every user-scoped route
    #    depends on these tables being present.
    await init_db()

    # 2. Validate embedding ↔ Pinecone dimension match
    embedder = get_embedder()
    await validate_embedding_dimension(embedder, settings.pinecone_dimension)

    # 3. Ensure Pinecone index exists and is ready
    pc = get_pinecone_client()
    await pc.initialise()

    logger.info("rag_api_ready", host=settings.host, port=settings.port)
    yield
    logger.info("rag_api_shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Production RAG API — FastAPI + Pinecone + Gemini",
        docs_url="/docs"        if not settings.is_production else None,
        redoc_url="/redoc"      if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ── Middleware ────────────────────────────────────────────────────────
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    if settings.prometheus_enabled:
        try:
            from prometheus_fastapi_instrumentator import Instrumentator
            Instrumentator().instrument(app).expose(app, endpoint="/metrics")
        except ImportError:
            logger.warning("prometheus_not_installed")

    # ── Routers ───────────────────────────────────────────────────────────
    # Import here to avoid circular imports at module level
    from app.api.routes.auth      import router as auth_router
    from app.api.routes.health    import router as health_router
    from app.api.routes.chat_sessions import router as chat_sessions_router
    from app.api.routes.documents import router as documents_router
    from app.api.routes.query     import router as query_router

    # health_router    → GET  /health                    (no prefix)
    # auth_router      → POST /api/v1/auth/...           (router has prefix="/auth")
    # documents_router → POST /api/v1/documents/...      (router has prefix="/documents")
    # query_router     → POST /api/v1/query/...          (router has prefix="/query")
    # chat_sessions    → /api/v1/chat-sessions/...      (router has prefix="/chat-sessions")
    app.include_router(health_router)
    app.include_router(auth_router,      prefix="/api/v1")
    app.include_router(documents_router, prefix="/api/v1")
    app.include_router(query_router,     prefix="/api/v1")
    app.include_router(chat_sessions_router, prefix="/api/v1")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        workers=settings.workers,
        reload=settings.reload,
        log_config=None,
    )