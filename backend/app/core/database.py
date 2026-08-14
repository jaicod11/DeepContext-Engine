"""
core/database.py
-----------------
Async SQLAlchemy engine + session factory for user storage.

Uses SQLite by default (zero extra infrastructure — a single file on
disk, works identically on any machine). DATABASE_URL is a standard
SQLAlchemy URL, so switching to PostgreSQL later needs no code change:

    DATABASE_URL=sqlite+aiosqlite:///./deepcontext.db          # default
    DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname    # later
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    """Declarative base all ORM models inherit from."""
    pass


_settings = get_settings()


def _normalise_db_url(url: str) -> str:
    """
    Managed Postgres providers hand out URLs the async engine can't use as-is:

        Render   postgresql://...  -> selects the *sync* psycopg2 driver
        Heroku   postgres://...    -> not a dialect SQLAlchemy recognises

    Both crash at startup (ModuleNotFoundError: psycopg2 / NoSuchModuleError:
    postgres). Rewriting them onto the async driver we actually ship means
    DATABASE_URL can be pasted straight from the provider's dashboard.

    SQLite URLs pass through untouched, so local dev is unaffected.
    """
    for prefix in ("postgresql+asyncpg://", "sqlite"):
        if url.startswith(prefix):
            return url
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


DATABASE_URL = _normalise_db_url(_settings.database_url)
_is_sqlite = DATABASE_URL.startswith("sqlite")

# check_same_thread=False is required for SQLite under async usage, and is
# NOT a valid asyncpg connect argument — so it must stay SQLite-only.
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

# Managed Postgres drops idle connections (Render and Supabase poolers do this
# aggressively). Without pre-ping the pool eventually hands out a dead socket
# and the first request after an idle period fails. Irrelevant for a local
# SQLite file, so it's applied only where it matters.
_engine_kwargs = {} if _is_sqlite else {"pool_pre_ping": True}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    connect_args=_connect_args,
    **_engine_kwargs,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db():
    """FastAPI dependency — yields a session, always closes it."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db() -> None:
    """
    Create tables if they don't exist. Called from main.py's lifespan
    on startup. Safe to run repeatedly.
    """
    # Import models so they register on Base.metadata before create_all
    from app.models.user import User  # noqa: F401
    from app.models.document_record import DocumentRecord  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("database_initialised", backend=DATABASE_URL.split("://")[0])