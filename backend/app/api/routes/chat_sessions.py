"""
api/routes/chat_sessions.py
----------------------------
GET    /api/v1/chat-sessions              — list my sessions, newest first
GET    /api/v1/chat-sessions/{doc_id}     — fetch one of my sessions
PUT    /api/v1/chat-sessions/{doc_id}     — upsert (create or replace)
DELETE /api/v1/chat-sessions/{doc_id}     — delete one of mine
DELETE /api/v1/chat-sessions              — clear all of mine

OWNERSHIP
---------
Every statement is filtered on `ChatSession.user_id == user.id`, and the
user comes from the JWT, never from the request. Reads and deletes for a
document_id the caller does not own return 404 rather than 403 — matching
delete_document in documents.py, and avoiding leaking whether a given
document_id exists for some other account.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.chat_session import (
    ChatSession,
    ChatSessionResponse,
    ChatSessionUpsertRequest,
)
from app.models.user import User

logger = get_logger(__name__)

router = APIRouter(prefix="/chat-sessions", tags=["Chat sessions"])


@router.get(
    "",
    response_model=list[ChatSessionResponse],
    summary="List your chat sessions, newest first",
)
async def list_sessions(
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
) -> list[ChatSessionResponse]:
    rows = (
        await db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == user.id)
            .order_by(ChatSession.updated_at.desc())
        )
    ).scalars().all()
    return [ChatSessionResponse.model_validate(r) for r in rows]


@router.get(
    "/{document_id}",
    response_model=ChatSessionResponse,
    summary="Fetch one of your chat sessions",
)
async def get_session(
    document_id: str,
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
) -> ChatSessionResponse:
    row = (
        await db.execute(
            select(ChatSession).where(
                ChatSession.user_id == user.id,
                ChatSession.document_id == document_id,
            )
        )
    ).scalar_one_or_none()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found.",
        )
    return ChatSessionResponse.model_validate(row)


@router.put(
    "/{document_id}",
    response_model=ChatSessionResponse,
    summary="Create or replace a chat session",
)
async def upsert_session(
    document_id: str,
    body: ChatSessionUpsertRequest,
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
) -> ChatSessionResponse:
    # Scoped SELECT doubles as the ownership check: if another user owns a
    # session for this document_id, this returns None and we INSERT a row
    # owned by the caller instead of overwriting theirs.
    existing = (
        await db.execute(
            select(ChatSession).where(
                ChatSession.user_id == user.id,
                ChatSession.document_id == document_id,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        row = ChatSession(
            user_id=user.id,
            document_id=document_id,
            filename=body.filename,
            messages=body.messages,
        )
        db.add(row)
    else:
        # PUT replaces the conversation wholesale.
        existing.filename = body.filename
        existing.messages = body.messages
        row = existing

    await db.commit()
    await db.refresh(row)

    logger.info(
        "chat_session_saved",
        user_id=user.id, document_id=document_id, messages=len(body.messages),
    )
    return ChatSessionResponse.model_validate(row)


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete one of your chat sessions",
)
async def delete_session(
    document_id: str,
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
) -> None:
    # Ownership check FIRST — a guessed document_id must not reach another
    # user's session.
    owned = (
        await db.execute(
            select(ChatSession).where(
                ChatSession.user_id == user.id,
                ChatSession.document_id == document_id,
            )
        )
    ).scalar_one_or_none()

    if owned is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found.",
        )

    await db.execute(
        sa_delete(ChatSession).where(
            ChatSession.user_id == user.id,
            ChatSession.document_id == document_id,
        )
    )
    await db.commit()
    logger.info("chat_session_deleted", user_id=user.id, document_id=document_id)


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Clear all of your chat sessions",
)
async def clear_sessions(
    user: User         = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        sa_delete(ChatSession).where(ChatSession.user_id == user.id)
    )
    await db.commit()
    logger.info("chat_sessions_cleared", user_id=user.id, deleted=result.rowcount)
