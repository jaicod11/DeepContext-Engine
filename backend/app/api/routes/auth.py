"""
api/routes/auth.py
-------------------
POST /api/v1/auth/register   — create account, returns JWT
POST /api/v1/auth/login      — authenticate, returns JWT
GET  /api/v1/auth/me         — current user profile
POST /api/v1/auth/claim-legacy — one-time migration (see below)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.user import (
    TokenResponse,
    User,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new account",
)
async def register(
    body: UserRegisterRequest,
    db:   AsyncSession = Depends(get_db),
) -> TokenResponse:
    email = body.email.lower().strip()

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        email=email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token, expires_in = create_access_token(user.id)
    logger.info("user_registered", user_id=user.id)

    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserResponse.model_validate(user),
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate and receive a JWT",
)
async def login(
    body: UserLoginRequest,
    db:   AsyncSession = Depends(get_db),
) -> TokenResponse:
    email = body.email.lower().strip()

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    # Identical error for "no such user" and "wrong password" — prevents
    # using this endpoint to discover which emails have accounts.
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password.",
    )

    if user is None or not verify_password(body.password, user.hashed_password):
        logger.warning("login_failed", email=email)
        raise invalid

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled.",
        )

    token, expires_in = create_access_token(user.id)
    logger.info("user_logged_in", user_id=user.id)

    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserResponse.model_validate(user),
    )


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Current authenticated user",
)
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.post(
    "/claim-legacy",
    summary="Claim pre-auth documents into your account",
    description=(
        "One-time migration. Documents ingested BEFORE authentication was "
        "added live in the shared 'default' Pinecone namespace and have no "
        "owner. This copies their vectors into the calling user's private "
        "namespace so they appear in that account's library.\n\n"
        "Only run this once, from the account that should own those legacy "
        "documents — running it from a second account would give that "
        "account a copy of the same documents."
    ),
)
async def claim_legacy_documents(
    user: User = Depends(get_current_user),
):
    from app.vectorstore.pinecone_client import get_pinecone_client

    pc = get_pinecone_client()

    try:
        moved = await pc.copy_namespace(
            source_namespace="default",
            target_namespace=user.namespace,
        )
    except AttributeError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "copy_namespace() is not implemented on PineconeClient. "
                "See the migration note in the auth setup instructions."
            ),
        )

    logger.info("legacy_documents_claimed", user_id=user.id, vectors=moved)
    return {
        "claimed_vectors": moved,
        "namespace": user.namespace,
        "detail": f"Copied {moved} vectors from 'default' into your namespace.",
    }