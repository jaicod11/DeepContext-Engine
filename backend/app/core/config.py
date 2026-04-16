"""
core/config.py
--------------
Centralised application settings using Pydantic v2 BaseSettings.
All values are loaded from environment variables (or a .env file when
running locally).  A single `get_settings()` function is provided so the
object is cached at process startup and shared across the entire app.
"""

from __future__ import annotations

import secrets
from enum import Enum
from functools import lru_cache
from typing import Annotated, Any

from pydantic import (
    AnyHttpUrl,
    Field,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class Environment(str, Enum):
    DEVELOPMENT = "development"
    STAGING     = "staging"
    PRODUCTION  = "production"


class LLMProvider(str, Enum):
    GEMINI = "gemini"
    OLLAMA = "ollama"


class EmbeddingProvider(str, Enum):
    GEMINI = "gemini"          # text-embedding-004
    OLLAMA = "ollama"          # nomic-embed-text or similar
    OPENAI = "openai"          # text-embedding-3-small (optional)


class PineconeMetric(str, Enum):
    COSINE     = "cosine"
    DOTPRODUCT = "dotproduct"
    EUCLIDEAN  = "euclidean"


# ──────────────────────────────────────────────
# Settings
# ──────────────────────────────────────────────

class Settings(BaseSettings):
    """
    Application-wide settings.

    Priority (highest → lowest):
      1. Actual environment variables
      2. Variables in `.env` file
      3. Default values defined here
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,   # PINECONE_API_KEY == pinecone_api_key
        extra="ignore",         # silently ignore unknown env vars
    )

    # ── App ──────────────────────────────────
    app_name: str         = Field(default="RAG API", description="Shown in OpenAPI docs")
    app_version: str      = Field(default="1.0.0")
    environment: Environment = Field(default=Environment.DEVELOPMENT)
    debug: bool           = Field(default=False)
    secret_key: str       = Field(
        default_factory=lambda: secrets.token_urlsafe(32),
        description="Used for signing tokens; always set explicitly in production",
    )

    # ── Server ───────────────────────────────
    host: str             = Field(default="0.0.0.0")
    port: int             = Field(default=8000, ge=1024, le=65535)
    workers: int          = Field(default=1, ge=1, le=32)
    reload: bool          = Field(default=False, description="Uvicorn hot-reload (dev only)")

    # ── CORS ─────────────────────────────────
    allowed_origins: list[AnyHttpUrl] = Field(
        default=["http://localhost:3000", "http://localhost:5173"],
        description="React dev servers; restrict in production",
    )

    # ── API Security ─────────────────────────
    api_key_header: str   = Field(default="X-API-Key")
    api_keys: list[str]   = Field(
        default=[],
        description="Comma-separated list of valid API keys; empty = auth disabled in dev",
    )
    rate_limit_per_minute: int = Field(default=60, ge=1)

    # ── Pinecone ─────────────────────────────
    pinecone_api_key: str         = Field(..., description="Pinecone API key — REQUIRED")
    pinecone_environment: str     = Field(
        default="us-east-1-aws",
        description="Cloud region of your Pinecone index",
    )
    pinecone_index_name: str      = Field(default="rag-index")
    pinecone_namespace: str       = Field(
        default="default",
        description="Namespace for multi-tenancy; use per-user or per-project values",
    )
    pinecone_metric: PineconeMetric = Field(default=PineconeMetric.COSINE)
    pinecone_dimension: int       = Field(
        default=768,
        description="Must match the output dimension of the embedding model",
    )
    pinecone_batch_size: int      = Field(
        default=100,
        description="Vectors per upsert call; reduce if hitting payload limits",
    )

    # ── Retrieval ────────────────────────────
    retrieval_top_k: int          = Field(
        default=20,
        ge=1, le=100,
        description="Candidate pool fetched from Pinecone before reranking",
    )
    reranker_top_n: int           = Field(
        default=5,
        ge=1, le=20,
        description="Final chunks passed to the LLM after cross-encoder reranking",
    )
    similarity_score_threshold: float = Field(
        default=0.70,
        ge=0.0, le=1.0,
        description="Minimum cosine similarity to include a chunk in results",
    )
    hybrid_alpha: float           = Field(
        default=0.75,
        ge=0.0, le=1.0,
        description="Weight of dense vs sparse in hybrid search (1.0 = dense only)",
    )

    # ── Text Splitting ───────────────────────
    chunk_size: int               = Field(default=512,  ge=64,  le=4096)
    chunk_overlap: int            = Field(default=64,   ge=0,   le=512)
    splitter_separators: list[str] = Field(
        default=["\n\n", "\n", ". ", " ", ""],
        description="LangChain RecursiveCharacterTextSplitter separators (in priority order)",
    )

    # ── Embedding ────────────────────────────
    embedding_provider: EmbeddingProvider = Field(default=EmbeddingProvider.GEMINI)
    embedding_model: str          = Field(
        default="models/text-embedding-004",
        description="Gemini model name OR Ollama model tag",
    )
    embedding_batch_size: int     = Field(
        default=50,
        description="Texts per embedding API call",
    )
    embedding_cache_ttl: int      = Field(
        default=86400,
        description="Seconds to cache embedding vectors in Redis (24 h default)",
    )

    # ── LLM ──────────────────────────────────
    llm_provider: LLMProvider     = Field(default=LLMProvider.GEMINI)
    gemini_api_key: str           = Field(default="", description="Required when llm_provider=gemini")
    gemini_model: str             = Field(default="gemini-1.5-pro")
    gemini_temperature: float     = Field(default=0.1,  ge=0.0, le=2.0)
    gemini_max_output_tokens: int = Field(default=2048, ge=64, le=8192)

    ollama_base_url: AnyHttpUrl   = Field(default="http://localhost:11434")  # type: ignore[assignment]
    ollama_model: str             = Field(default="llama3")
    ollama_temperature: float     = Field(default=0.1, ge=0.0, le=2.0)

    # ── Reranker ─────────────────────────────
    reranker_enabled: bool        = Field(
        default=True,
        description="Toggle cross-encoder reranking; disable for lowest latency",
    )
    reranker_model: str           = Field(
        default="cross-encoder/ms-marco-MiniLM-L-6-v2",
        description="HuggingFace cross-encoder model; smaller = faster, larger = better",
    )
    reranker_device: str          = Field(
        default="cpu",
        description="'cpu', 'cuda', or 'mps' for Apple Silicon",
    )

    # ── Redis (cache + rate limiting) ────────
    redis_url: str                = Field(default="redis://localhost:6379/0")
    redis_query_cache_ttl: int    = Field(
        default=3600,
        description="Seconds to cache full RAG answers (1 h default)",
    )

    # ── Object Storage ───────────────────────
    storage_provider: str         = Field(
        default="local",
        description="'local', 's3', or 'gcs'",
    )
    storage_bucket: str           = Field(default="rag-documents")
    aws_access_key_id: str        = Field(default="")
    aws_secret_access_key: str    = Field(default="")
    aws_region: str               = Field(default="us-east-1")
    gcs_credentials_json: str     = Field(default="", description="Path to GCP service-account JSON")

    # ── Observability ────────────────────────
    log_level: str                = Field(default="INFO")
    log_json: bool                = Field(
        default=False,
        description="Emit structured JSON logs (set True in staging/production)",
    )
    sentry_dsn: str               = Field(default="", description="Optional Sentry DSN for error tracking")
    prometheus_enabled: bool      = Field(default=True)

    # ──────────────────────────────────────────
    # Validators
    # ──────────────────────────────────────────

    @field_validator("api_keys", mode="before")
    @classmethod
    def _parse_api_keys(cls, v: Any) -> list[str]:
        """Accept a comma-separated string OR a list from the env file."""
        if isinstance(v, str):
            return [k.strip() for k in v.split(",") if k.strip()]
        return v

    @field_validator("chunk_overlap")
    @classmethod
    def _overlap_less_than_chunk(cls, v: int, info: Any) -> int:
        chunk_size = info.data.get("chunk_size", 512)
        if v >= chunk_size:
            raise ValueError(
                f"chunk_overlap ({v}) must be less than chunk_size ({chunk_size})"
            )
        return v

    @field_validator("reranker_top_n")
    @classmethod
    def _reranker_n_le_top_k(cls, v: int, info: Any) -> int:
        top_k = info.data.get("retrieval_top_k", 20)
        if v > top_k:
            raise ValueError(
                f"reranker_top_n ({v}) must be ≤ retrieval_top_k ({top_k})"
            )
        return v

    @model_validator(mode="after")
    def _production_guards(self) -> "Settings":
        """Enforce stricter rules when running in production."""
        if self.environment == Environment.PRODUCTION:
            if not self.api_keys:
                raise ValueError(
                    "api_keys must not be empty in production — "
                    "set the API_KEYS environment variable."
                )
            if self.debug:
                raise ValueError("debug must be False in production.")
            if self.reload:
                raise ValueError("reload must be False in production.")
            if not self.log_json:
                import warnings
                warnings.warn(
                    "log_json=False in production; structured JSON logs are recommended.",
                    stacklevel=2,
                )
        return self

    # ──────────────────────────────────────────
    # Derived helpers
    # ──────────────────────────────────────────

    @property
    def is_production(self) -> bool:
        return self.environment == Environment.PRODUCTION

    @property
    def is_development(self) -> bool:
        return self.environment == Environment.DEVELOPMENT

    @property
    def active_llm_model(self) -> str:
        """Return the model name for whichever provider is active."""
        return self.gemini_model if self.llm_provider == LLMProvider.GEMINI else self.ollama_model

    @property
    def active_embedding_model(self) -> str:
        return self.embedding_model

    @property
    def cors_origins(self) -> list[str]:
        """Convert AnyHttpUrl objects to plain strings for FastAPI."""
        return [str(o) for o in self.allowed_origins]

    def redacted_dict(self) -> dict[str, Any]:
        """
        Return settings as a dict with sensitive values masked.
        Safe to log at startup.
        """
        sensitive = {
            "pinecone_api_key", "gemini_api_key", "secret_key",
            "api_keys", "aws_secret_access_key", "sentry_dsn",
        }
        data = self.model_dump()
        for key in sensitive:
            if data.get(key):
                data[key] = "***REDACTED***"
        return data


# ──────────────────────────────────────────────
# Singleton accessor
# ──────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Return a cached Settings instance.

    Usage in FastAPI dependency injection:
        from app.core.config import get_settings
        from fastapi import Depends

        def some_route(settings: Settings = Depends(get_settings)):
            ...

    Or import directly outside of request context:
        settings = get_settings()
    """
    return Settings()  # type: ignore[call-arg]
