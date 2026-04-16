# ──────────────────────────────────────────────────────────────────────────────
# frontend/Dockerfile
# Multi-stage build:
#   builder  — Node.js installs deps + runs `vite build`
#   runtime  — Nginx serves the static dist/ folder
#
# Build:
#   docker build -t rag-frontend:latest .
#
# Run standalone:
#   docker run -p 3000:80 rag-frontend:latest
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Node builder ─────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first — layer cache skips npm install when unchanged
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile

COPY . .

# Build-time env vars (override with --build-arg in CI/CD)
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_API_KEY=""
ARG VITE_APP_NAME="RAG Intelligence"

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_KEY=$VITE_API_KEY \
    VITE_APP_NAME=$VITE_APP_NAME

RUN npm run build

# ── Stage 2: Nginx runtime ────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.spa.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
