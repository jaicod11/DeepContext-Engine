"""
core/config.py
--------------
Centralised application settings using Pydantic v2 BaseSettings.
All values are loaded from environment variables (or a .env file when
running locally).  A single `get_settings()` function is provided so the
object is cached at process startup and shared across the entire app.
"""

from __future__ import annotations

import json
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
# List-valued env vars
# ──────────────────────────────────────────────
#
# Every multi-value setting below is declared as `str`, never `list[...]`.
#
# pydantic-settings treats a complex annotation (list/dict/set) as JSON and
# runs json.loads() on the raw env var inside EnvSettingsSource — BEFORE any
# field_validator, including mode="before" ones. So a perfectly reasonable
# value typed into a hosting dashboard:
#
#     ALLOWED_ORIGINS=https://my-app.vercel.app
#
# never reaches validation. It fails to parse as JSON and the app dies at
# import with:
#
#     SettingsError: error parsing value for field "allowed_origins"
#                    from source "EnvSettingsSource"
#
# Declaring the field as `str` sidesteps the JSON decoding entirely, and the
# value is split by the properties further down.


def _parse_list_env(raw: str | None, *, strip: bool = True) -> list[str]:
    """
    Split one of the list-valued settings into its entries.

    Accepts both forms so nothing has to be reformatted:
      * comma-separated  — what you type into Render/Heroku/Fly dashboards
      * a JSON array     — what existing .env files in this repo already use

    Returns [] for blank input.

    `strip=True` (the default) trims each entry and drops empties, which is
    what you want for origins, API keys and provider:model entries — the
    whitespace around a comma is incidental.

    `strip=False` returns JSON entries verbatim. Only the text-splitter
    separators need this: several of them ARE whitespace ("\\n\\n", " ") or
    the empty string, and trimming would silently corrupt them — ". " would
    become "." and the rest would vanish.
    """
    if not raw:
        return []

    text = raw.strip()

    # Existing .env files use JSON arrays; keep reading them.
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                entries = [str(x) for x in parsed]
                if not strip:
                    return entries          # exact values, whitespace intact
                return [e.strip() for e in entries if e.strip()]
        except json.JSONDecodeError:
            # Fall through and treat it as comma-separated — a malformed
            # array shouldn't take the whole app down at import time.
            pass

    parts = text.split(",")
    if not strip:
        return parts
    return [p.strip() for p in parts if p.strip()]


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
        description=(
            "Signs JWT access tokens. MUST be set explicitly in .env — "
            "the random default is regenerated on every process start, "
            "which silently invalidates every outstanding login token."
        ),
    )

    # ── Server ───────────────────────────────
    host: str             = Field(default="0.0.0.0")
    port: int             = Field(default=8000, ge=1024, le=65535)
    workers: int          = Field(default=1, ge=1, le=32)
    reload: bool          = Field(default=False, description="Uvicorn hot-reload (dev only)")

    # ── CORS ─────────────────────────────────
    # Typed as a plain str, NOT list[...] — see _parse_list_env above.
    allowed_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173",
        description=(
            "Comma-separated allowed origins (a JSON array also works). "
            "React dev servers by default; restrict in production. "
            "Read it through the cors_origins property, never directly."
        ),
    )

    # ── Auth / Database ──────────────────────
    database_url: str     = Field(
        default="sqlite+aiosqlite:///./deepcontext.db",
        description=(
            "SQLAlchemy async URL for user + document-library storage. "
            "SQLite by default (single file, zero extra infra). "
            "Swap to postgresql+asyncpg://... with no code changes."
        ),
    )
    jwt_algorithm: str    = Field(
        default="HS256",
        description="JWT signing algorithm; HS256 uses secret_key symmetrically",
    )
    access_token_expire_minutes: int = Field(
        default=60 * 24 * 7,   # 7 days
        ge=5,
        description="How long a login token stays valid before re-login is required",
    )

    # ── API Security ─────────────────────────
    api_key_header: str   = Field(default="X-API-Key")
    api_keys: str         = Field(
        default="",
        description=(
            "Comma-separated keys (a JSON array also works). Legacy "
            "shared-secret auth, superseded by JWT user auth for all "
            "user-facing routes; retained for service-to-service use. "
            "Read it through the api_key_list property, never directly."
        ),
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
        description=(
            "Fallback namespace only. With auth enabled, every user-facing "
            "route derives its namespace from the authenticated user "
            "(user_<uuid>), never from this setting."
        ),
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
    splitter_separators: str = Field(
        default="",
        description=(
            "LangChain RecursiveCharacterTextSplitter separators, in priority "
            "order, as a JSON array. Leave BLANK to use the built-in defaults "
            "— they include a bare space and an empty string, which a "
            "comma-separated list cannot represent. Read it through the "
            "splitter_separator_list property, never directly."
        ),
    )
    llm_fallback_chain: str = Field(
        default="",
        description=(
            "Comma-separated 'provider:model' entries (a JSON array also "
            "works), tried in order. Read it through the "
            "llm_fallback_chain_list property, never directly."
        ),
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
            # secret_key falls back to a default_factory that mints a NEW random
            # value on every process start. In production that means every JWT
            # issued before a restart or redeploy silently fails validation, and
            # users are bounced to the login screen with an opaque 401 that looks
            # like a bug in auth rather than missing config. model_fields_set
            # contains only fields supplied explicitly (env var or .env), so its
            # absence means the random fallback is in play.
            if "secret_key" not in self.model_fields_set:
                raise ValueError(
                    "SECRET_KEY is not set, but ENVIRONMENT=production.\n"
                    "The fallback generates a new random key on every start, which "
                    "invalidates every existing login token on each restart/redeploy.\n"
                    "Set SECRET_KEY to a stable secret in the environment, e.g.:\n"
                    "    SECRET_KEY=$(python -c 'import secrets; print(secrets.token_urlsafe(32))')\n"
                    "Store it in your host's secret manager (Render: Environment tab) "
                    "and keep it identical across deploys."
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

    # ── Accessors for the list-valued settings ───────────────────────────
    # These are the ONLY supported way to read those fields; the raw
    # attributes are undivided strings. See _parse_list_env at the top.

    @property
    def cors_origins(self) -> list[str]:
        """
        Allowed origins, trailing slash stripped.

        The stripping matters: browsers send `Origin` without a trailing
        slash, so a configured "https://app.vercel.app/" would never match
        and every cross-origin request would be rejected.
        """
        return [o.rstrip("/") for o in _parse_list_env(self.allowed_origins)]

    @property
    def api_key_list(self) -> list[str]:
        """Legacy shared-secret API keys."""
        return _parse_list_env(self.api_keys)

    @property
    def llm_fallback_chain_list(self) -> list[str]:
        """'provider:model' entries to try in order when the primary fails."""
        return _parse_list_env(self.llm_fallback_chain)

    @property
    def splitter_separator_list(self) -> list[str]:
        """
        Text-splitter separators.

        Blank (the normal case) yields the built-in defaults. They are
        returned from here rather than the field default because two of
        them — a bare space and an empty string — cannot survive a
        comma-separated round trip: stripping turns " " into "" and the
        empty final separator gets dropped. Losing the empty separator
        silently changes chunking, since it is what lets
        RecursiveCharacterTextSplitter split inside an over-long word.
        """
        parsed = _parse_list_env(self.splitter_separators, strip=False)
        return parsed or ["\n\n", "\n", ". ", " ", ""]

    def redacted_dict(self) -> dict[str, Any]:
        """
        Return settings as a dict with sensitive values masked.
        Safe to log at startup.
        """
        sensitive = {
            "pinecone_api_key", "gemini_api_key", "secret_key",
            "api_keys", "aws_secret_access_key", "sentry_dsn",
            "database_url",   # may embed DB credentials once off SQLite
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