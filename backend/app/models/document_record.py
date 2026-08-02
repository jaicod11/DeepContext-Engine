"""
models/document_record.py
--------------------------
Persistent record of every ingested document, owned by a user.

WHY THIS EXISTS
---------------
Before auth, the document list lived only in the browser's Zustand
store and was never persisted — so it vanished on every refresh even
though the vectors were safely in Pinecone the whole time.

Pinecone itself is a poor source of truth for "list my documents":
there's no efficient distinct-by-metadata query, so listing would mean
scanning vectors. A tiny relational table is the right tool — it gives
filename, upload time, chunk count, and ownership in one indexed query.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DocumentRecord(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    # The Pinecone document_id (content hash) — NOT unique globally,
    # because two users may independently upload the same file and each
    # legitimately owns their own copy in their own namespace.
    document_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )

    filename:     Mapped[str] = mapped_column(String(512), nullable=False)
    chunks_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    namespace:    Mapped[str] = mapped_column(String(128), nullable=False)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )


# ─────────────────────────────────────────────
# Response schema
# ─────────────────────────────────────────────

class DocumentRecordResponse(BaseModel):
    document_id:  str
    filename:     str
    chunks_total: int
    namespace:    str
    uploaded_at:  datetime

    model_config = {"from_attributes": True}