"""
models/chat_session.py
-----------------------
Server-side chat history, owned by a user and keyed by document.

WHY THIS EXISTS
---------------
Chat sessions used to live only in the browser's Zustand store, so
signing in from a second browser showed an empty Chat History page —
exactly the problem DocumentRecord solved for the document library.
This mirrors that model's conventions: String(36) UUID primary key,
user_id FK with ON DELETE CASCADE, server-side timestamps.

STORAGE FORMAT: ONE JSON COLUMN, NOT A ChatMessage TABLE
--------------------------------------------------------
Messages are stored as a JSON array on the session row rather than as
rows in a child table. The deciding factor is how the data is actually
used:

  * The client only ever reads or writes a WHOLE conversation. The API
    surface is a per-document upsert (PUT replaces the session), which
    maps to overwriting one column — with a child table the same
    operation becomes "delete all rows for this session, re-insert N",
    which is more code and more round-trips for no benefit.
  * Nothing queries, filters, sorts or aggregates by an individual
    message field. There is no "search across messages" feature; the
    history page filters by filename client-side.
  * A message already contains a nested `sources[]` array of objects. A
    normalised design would need either a third table or a JSON column
    anyway, so it would not actually be schema-free.
  * Message ordering is intrinsic to a JSON array. A child table needs
    an explicit position column kept in sync on every rewrite.

The cost is that individual messages are not queryable in SQL. That is
acceptable while no feature needs it; if full-text search over messages
is ever added, the messages array can be normalised into a child table
behind the same routes without changing the API.

PORTABILITY (SQLite + PostgreSQL)
---------------------------------
The column uses SQLAlchemy's generic JSON type with a PostgreSQL JSONB
variant. On SQLite it is stored as TEXT with automatic JSON
serialisation; on PostgreSQL it becomes native JSONB. Both are handled
by the driver, so the same model runs unmodified against the local
SQLite file and a managed Postgres — verified against both.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# Generic JSON everywhere, JSONB on PostgreSQL where it is available.
MessagesJSON = JSON().with_variant(JSONB, "postgresql")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    # One session per (user, document): the routes are keyed by document_id
    # and PUT is an upsert, so a second row for the same pair is never valid.
    __table_args__ = (
        UniqueConstraint("user_id", "document_id", name="uq_chat_sessions_user_doc"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )

    # The Pinecone document_id this conversation belongs to. Not globally
    # unique — two users can each hold a session for the same document.
    document_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    # Denormalised so the history list renders without joining documents,
    # and still reads correctly if the document is later deleted.
    filename: Mapped[str] = mapped_column(String(512), nullable=False)

    messages: Mapped[list[dict[str, Any]]] = mapped_column(
        MessagesJSON, nullable=False, default=list,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False,
    )


# ─────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────

class ChatSessionUpsertRequest(BaseModel):
    """Body for PUT /chat-sessions/{document_id}."""
    filename: str = Field(..., max_length=512)
    # Messages are passed through as-is. They are the client's own shape
    # (role, content, sources[], latency_ms, timestamp, id) and the server
    # never interprets them, so they are not modelled field-by-field —
    # doing so would mean a backend change every time the UI adds a field.
    messages: list[dict[str, Any]] = Field(default_factory=list)


class ChatSessionResponse(BaseModel):
    document_id: str
    filename:    str
    messages:    list[dict[str, Any]]
    created_at:  datetime
    updated_at:  datetime

    model_config = {"from_attributes": True}
