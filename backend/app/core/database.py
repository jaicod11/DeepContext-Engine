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

# check_same_thread=False is required for SQLite under async usage.
_connect_args = (
    {"check_same_thread": False}
    if _settings.database_url.startswith("sqlite")
    else {}
)

engine = create_async_engine(
    _settings.database_url,
    echo=False,
    future=True,
    connect_args=_connect_args,
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
    logger.info("database_initialised", backend=_settings.database_url.split("://")[0])