"""GET /health — liveness + readiness probe."""
from fastapi import APIRouter, Depends
from app.core.config import Settings, get_settings
from app.core.security import public_rate_limit
from app.models.query import HealthResponse
from app.vectorstore.pinecone_client import PineconeClient, get_pinecone_client

router = APIRouter(tags=["Health"])

@router.get("/health", response_model=HealthResponse, summary="Service health check")
async def health(
    pc:       PineconeClient = Depends(get_pinecone_client),
    settings: Settings       = Depends(get_settings),
    _:        None           = Depends(public_rate_limit),
) -> HealthResponse:
    pinecone_status = await pc.health_check()
    return HealthResponse(
        status="ok" if pinecone_status.get("status") == "ok" else "degraded",
        version=settings.app_version,
        pinecone=pinecone_status,
    )
