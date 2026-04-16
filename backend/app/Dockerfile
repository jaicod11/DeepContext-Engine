# ──────────────────────────────────────────────────────────────────────────────
# Dockerfile — Production multi-stage build
#
# Stages:
#   builder  — install Python deps into a virtual-env (no dev tools)
#   runtime  — minimal image with only the venv and app code
#
# Build:
#   docker build -t rag-api:latest .
#
# Run:
#   docker run -p 8000:8000 --env-file .env rag-api:latest
#
# Multi-platform (for deployment to ARM/Graviton):
#   docker buildx build --platform linux/amd64,linux/arm64 -t rag-api:latest .
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

# Prevent .pyc files and enable unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# System deps required by some Python packages (pypdf, python-docx, torch)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        g++ \
        libffi-dev \
        libssl-dev \
        git \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy and install dependencies FIRST (Docker layer cache)
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    # Ensure Python can find the app package
    PYTHONPATH="/app"

# Runtime-only system libs
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \        
        curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd --gid 1001 appuser && \
    useradd  --uid 1001 --gid appuser --shell /bin/bash --create-home appuser

WORKDIR /app

# Copy virtual env from builder
COPY --from=builder /opt/venv /opt/venv

# Copy application source
COPY --chown=appuser:appuser app/ ./app/

# Drop to non-root
USER appuser

# Expose the FastAPI port
EXPOSE 8000

# Healthcheck — Docker will mark the container unhealthy if this fails
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Default: single-worker production server
# Override workers via WORKERS env var in docker-compose or K8s
CMD ["sh", "-c", "uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers ${WORKERS:-1} \
    --log-config /dev/null \
    --access-log"]
