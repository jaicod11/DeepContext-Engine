"""
models/user.py
---------------
User ORM model + Pydantic request/response schemas.

NAMESPACE ISOLATION
-------------------
Every user gets a dedicated Pinecone namespace derived from their UUID:

    namespace = f"user_{user.id}"

All ingestion and retrieval for that user is scoped to this namespace,
so one user's vectors are physically unreachable from another user's
queries — isolation is enforced at the vector-store layer, not just by
filtering in application code.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


# ─────────────────────────────────────────────
# ORM model
# ─────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False,
    )
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    @property
    def namespace(self) -> str:
        """Pinecone namespace owned exclusively by this user."""
        return f"user_{self.id}"


# ─────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────

class UserRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72)
    full_name: str | None = Field(default=None, max_length=255)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=72)


class UserUpdateRequest(BaseModel):
    """
    PATCH /auth/me body. Only full_name is editable — email is the login
    identity and password changes are deliberately out of scope.

    full_name is Optional so it can be explicitly cleared with null, but the
    field is required in the payload: a PATCH with no keys at all is a no-op
    the route rejects rather than silently accepting.
    """
    full_name: str | None = Field(..., max_length=255)


class UserResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int          # seconds
    user: UserResponse