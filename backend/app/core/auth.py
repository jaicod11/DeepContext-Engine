"""
core/auth.py
-------------
Password hashing (bcrypt) + JWT issue/verify + the get_current_user
FastAPI dependency that every protected route depends on.

WHY NOT PASSLIB
---------------
passlib 1.7.4 (last released 2020) probes bcrypt via
`bcrypt.__about__.__version__`, an attribute removed in bcrypt 4.1+.
That probe crashes with AttributeError, then passlib's fallback
self-test feeds bcrypt an over-long string — which modern bcrypt
rejects with ValueError instead of silently truncating. The result is
a confusing "password cannot be longer than 72 bytes" error even for a
15-character password.

Using the bcrypt library directly avoids that entire broken layer.
bcrypt's own API is small and stable: hashpw / checkpw / gensalt.

SECURITY NOTES
--------------
• Passwords are hashed with bcrypt, never stored or logged in plaintext.
• bcrypt silently truncates input beyond 72 BYTES. We reject longer
  passwords explicitly instead — silent truncation means two different
  long passwords could authenticate each other, which is a real
  vulnerability, not a cosmetic one.
• Login failures never reveal WHICH part was wrong (unknown email vs
  wrong password) — both return the identical error, so the endpoint
  can't be used to enumerate which emails have accounts.
• JWTs are signed with SECRET_KEY. Rotating that key invalidates every
  outstanding token, which is the intended emergency lever.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.user import User

logger = get_logger(__name__)

_bearer = HTTPBearer(auto_error=False)

MAX_PASSWORD_BYTES = 72


# ─────────────────────────────────────────────
# Password hashing (bcrypt directly)
# ─────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a plaintext password. Returns the full bcrypt hash string."""
    pw_bytes = password.encode("utf-8")

    if len(pw_bytes) > MAX_PASSWORD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at most {MAX_PASSWORD_BYTES} bytes.",
        )

    hashed = bcrypt.hashpw(pw_bytes, bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time comparison of a plaintext password against a hash."""
    pw_bytes = plain.encode("utf-8")

    # Over-long input can't be a valid password we ever hashed, since
    # hash_password() rejects those outright.
    if len(pw_bytes) > MAX_PASSWORD_BYTES:
        return False

    try:
        return bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed/corrupt hash in the DB — treat as a failed login
        # rather than a 500.
        return False


# ─────────────────────────────────────────────
# JWT
# ─────────────────────────────────────────────

def create_access_token(user_id: str, settings: Settings | None = None) -> tuple[str, int]:
    """Returns (token, expires_in_seconds)."""
    s = settings or get_settings()
    expires_delta = timedelta(minutes=s.access_token_expire_minutes)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, s.secret_key, algorithm=s.jwt_algorithm)
    return token, int(expires_delta.total_seconds())


def decode_access_token(token: str, settings: Settings | None = None) -> str:
    """Returns the user_id (sub claim). Raises 401 if invalid/expired."""
    s = settings or get_settings()
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, s.secret_key, algorithms=[s.jwt_algorithm])
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise credentials_exc
        return user_id
    except JWTError:
        raise credentials_exc


# ─────────────────────────────────────────────
# FastAPI dependency
# ─────────────────────────────────────────────

async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db:    AsyncSession = Depends(get_db),
) -> User:
    """
    Resolves the authenticated user from the Authorization: Bearer <jwt>
    header. Every protected route depends on this.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = decode_access_token(creds.credentials)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled.",
        )
    return user