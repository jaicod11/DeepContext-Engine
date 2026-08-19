# 🧠 DeepContext Engine

<div align="center">

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Pinecone](https://img.shields.io/badge/Pinecone-Serverless-000000?style=for-the-badge&logo=pinecone&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-Flash-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Postgres](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

**A production Retrieval-Augmented Generation (RAG) application: multi-user document Q&A with a two-stage retrieval pipeline, streaming answers, and inline source citations.**

[Live Demo](#-live-demo) · [Features](#-features) · [Architecture](#-architecture) · [Quick Start](#-quick-start) · [API Docs](#-api-reference) · [Deployment](#-deployment)

</div>

---

## 🌐 Live Demo

### **[deep-context.vercel.app](https://deep-context.vercel.app/)**

Create an account, upload a document, and ask questions about it.

> ⏱️ **First request may take 30–60 seconds.** The backend runs on a free-tier
> Render instance that sleeps after inactivity, so the first call after an idle
> period has to wake the container. Everything is fast once it's warm.

> 💡 Reranking is **disabled** in the hosted demo — the cross-encoder needs more
> memory than the 512MB free tier allows. Retrieval still works (vector search
> only); see [DEPLOYMENT.md](DEPLOYMENT.md) for the full explanation.

---

## 📋 Table of Contents

- [Live Demo](#-live-demo)
- [Why I Built This](#-why-i-built-this)
- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [Two-Stage Retrieval](#two-stage-retrieval)
- [Deployment](#-deployment)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)

---

## 🔥 Why I Built This

Most RAG systems retrieve noisy or weak context — they embed a query, grab the top-k nearest vectors, and hand everything to the LLM hoping for the best. The result is answers padded with irrelevant chunks, hallucinated citations, and no clear grounding.

DeepContext Engine explores how **multi-stage retrieval, cross-encoder reranking, and streaming architectures** can improve answer grounding and response quality in production AI systems.

The core insight: combining a fast approximate search (Pinecone ANN) with a precise cross-encoder reranker creates a retrieval pipeline that is both fast and accurate — something neither approach achieves alone.

---

## 🎯 Overview

DeepContext Engine is a full-stack, multi-user document question-answering system that allows you to:

- **Create an account** and keep your documents private to you
- **Upload documents** (PDF, DOCX, PPTX, XLSX/XLS, TXT, MD, HTML) and ingest them into a vector database
- **Ask questions** in natural language and receive grounded, cited answers
- **Stream responses** token-by-token for a real-time chat experience
- **Compare 2–3 documents** at once, asking a single question across all of them
- **Resume conversations** — chat history is stored server-side and follows your account across devices

Answers come back as clean prose — the prompt explicitly instructs the model **not** to embed `[SOURCE N]` markers in the text, and the frontend strips any that slip through. Citations are returned alongside each answer as a **structured list of the exact chunks used**, each with its relevance score and, where the format provides it, a page number (PDF), slide number (PPTX) or sheet name (XLSX).

---

## ✨ Features

### Authentication & multi-tenancy
- 🔐 **JWT authentication** — register / login, tokens signed with HS256
- 🔑 **bcrypt password hashing** (used directly, not via passlib)
- 🙈 **Per-user Pinecone namespaces** — every account gets its own namespace
  (`user_<uuid>`), so one user's vectors are unreachable from another user's
  queries. Isolation is enforced at the vector-store layer, not by filtering in
  application code
- 🗄️ **SQLAlchemy 2 (async)** over **PostgreSQL** in production or **SQLite**
  locally — same code, switched by `DATABASE_URL`
- 👤 **Profile management** — view account details, edit display name

### Retrieval & generation
- ⚡ **FastAPI** with async/await throughout — non-blocking I/O
- 🔍 **Two-stage retrieval** — Pinecone ANN candidates, then cross-encoder reranking
- 🧠 **Gemini** for generation, **Gemini Embedding 001** (3072-dim) for vectorisation
- 🔁 **Model fallback chain** (`LLM_FALLBACK_CHAIN`) — automatic failover across
  multiple Gemini tiers, with an optional Ollama tier for local models
- 🦙 **Ollama provider** — run generation against a local model instead of Gemini
- 🔄 **LangChain** orchestration with citation-enforcing prompt templates
- 💬 **Multi-turn chat** with automatic question condensation
- 📁 **Multi-format ingestion** — PDF, DOCX, PPTX, XLSX/XLS, TXT, MD, HTML
- 💾 **Redis** caching for embeddings

### Frontend
- ⚛️ **React 18** with Zustand state management and React Router
- 🌊 **Server-Sent Events** streaming — token-by-token response display
- 🌓 **Light / dark theme** — green-on-black or orange-on-white, applied before
  first paint (no flash) and remembered per device
- 📎 **Drag-and-drop** file upload with live progress tracking
- 📚 **Source citations panel** — expandable chunk previews with relevance scores
- 🗂️ **Multi-document comparison** — select 2–3 documents and query across them
- 🕘 **Server-side chat history** — sessions persist per account and sync across browsers
- ✨ **Document insights** — generated key-topic summaries, cached client-side

### Operations
- 🪵 **Structured logging** via structlog (JSON in production)
- 📊 **Prometheus metrics** at `/metrics` (opt-in via `PROMETHEUS_ENABLED`)
- 🛡️ **Production config guards** — refuses to boot in production without an
  explicit `SECRET_KEY`, or with `DEBUG`/`RELOAD` enabled

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  DocumentChat │ MultiDocCompare │ History │ Settings     │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP / SSE  (Bearer JWT)
┌───────────────────────▼─────────────────────────────────┐
│                  FastAPI Gateway                         │
│  JWT Auth │ CORS │ Request-ID │ Prometheus (opt-in)      │
├─────────────────────────────────────────────────────────┤
│              Query Pipeline          Ingestion Pipeline  │
│  RAGChain → RetrievalService    DocLoader → TextSplitter │
│  → PineconeClient (ANN)         → GeminiEmbedder         │
│  → RerankerService              → PineconeClient.upsert  │
│  → LLMService (Gemini/Ollama)                            │
├─────────────────────────────────────────────────────────┤
│                     Data Layer                           │
│  Pinecone (vectors, namespaced per user)                 │
│  Postgres/SQLite (users, document records, chat sessions)│
│  Redis (embedding cache)                                 │
└─────────────────────────────────────────────────────────┘
```

### Two-Stage Retrieval

```
User Query
    │
    ▼
Embed Query (Gemini Embedding 001)
    │
    ▼
Stage 1: Pinecone ANN Search ──── top-K candidates (fast, approximate)
    │
    ▼
Stage 2: Cross-Encoder Reranking ─ top-N precision-ranked
    │
    ▼
Format Context + Citation-Enforcing Prompt
    │
    ▼
Gemini
    │
    ▼
Grounded Answer with [SOURCE N] citations
```

The bi-encoder embeds query and chunk **independently** — fast but imprecise. The cross-encoder sees them **together**, allowing attention to model their interaction — slower but more accurate. Combining both gives speed and precision.

> **Note:** Stage 2 is skipped when `RERANKER_ENABLED=False`, in which case the
> top-N candidates are taken directly from the vector-similarity ordering. This
> is the case in the hosted demo (memory limits) but not locally.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **LLM** | Google Gemini (model configurable; fallback chain supported) |
| **Embeddings** | Gemini Embedding 001 (3072-dim) |
| **Vector DB** | Pinecone (Serverless) |
| **Reranker** | cross-encoder/ms-marco-MiniLM-L-6-v2 (sentence-transformers) |
| **Framework** | FastAPI + LangChain |
| **Auth** | JWT (python-jose) + bcrypt |
| **Database** | SQLAlchemy 2 async — PostgreSQL (prod) / SQLite (dev) |
| **Frontend** | React 18 + Vite + Zustand + React Router |
| **Cache** | Redis |
| **Logging** | structlog |
| **Monitoring** | Prometheus + FastAPI Instrumentator (opt-in) |
| **Container** | Docker + Docker Compose |
| **Proxy** | Nginx |

---

## 📁 Project Structure

```
deepcontext-engine/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── auth.py           # register, login, me, PATCH me
│   │   │   │   ├── query.py          # POST /query, POST /query/chat
│   │   │   │   ├── documents.py      # list, upload, ingest, delete, stats
│   │   │   │   ├── chat_sessions.py  # server-side chat history CRUD
│   │   │   │   └── health.py         # GET /health
│   │   │   └── dependencies.py       # FastAPI DI wiring
│   │   ├── chains/
│   │   │   ├── rag_chain.py          # LangChain RAG pipeline
│   │   │   └── prompt_templates.py   # Citation-enforcing prompts
│   │   ├── core/
│   │   │   ├── config.py             # Pydantic Settings + production guards
│   │   │   ├── database.py           # Async engine, session, init_db
│   │   │   ├── auth.py               # bcrypt + JWT + get_current_user
│   │   │   ├── logging.py            # structlog setup
│   │   │   └── security.py           # Legacy API-key auth + rate limiting
│   │   ├── models/
│   │   │   ├── user.py               # User ORM + auth schemas
│   │   │   ├── document_record.py    # Per-user document library
│   │   │   ├── chat_session.py       # Server-side chat history
│   │   │   ├── query.py              # Request/response schemas
│   │   │   └── document.py           # Document schemas
│   │   ├── services/
│   │   │   ├── ingestion_service.py  # Document ingestion pipeline
│   │   │   ├── retrieval_service.py  # Two-stage retrieval
│   │   │   ├── reranker_service.py   # Cross-encoder reranking
│   │   │   └── llm_service.py        # Gemini / Ollama + fallback chain
│   │   ├── vectorstore/
│   │   │   ├── pinecone_client.py    # Pinecone operations
│   │   │   └── embeddings.py         # Embedding wrapper + Redis cache
│   │   └── main.py                   # FastAPI app factory + lifespan
│   ├── tests/{unit,integration}/
│   ├── Dockerfile
│   ├── requirements.txt              # runtime deps
│   ├── requirements-dev.txt          # test/lint tooling
│   └── requirements-reranker.txt     # optional torch + sentence-transformers
│
├── frontend/
│   ├── src/
│   │   ├── pages/                    # Dashboard, Documents, DocumentChat,
│   │   │                             # MultiDocChat, ChatHistory, Insights,
│   │   │                             # Settings, Profile, Login
│   │   ├── components/layout|shared/ # IconSidebar, Toast, UploadStatusWidget
│   │   ├── hooks/                    # useDocuments, useChatSessions, useThemeToken
│   │   ├── services/api.js           # Axios + SSE client
│   │   ├── stores/                   # appStore, authStore, themeStore
│   │   └── index.css                 # Design tokens + light/dark themes
│   ├── Dockerfile
│   └── vite.config.js
│
├── infra/nginx.conf
├── DEPLOYMENT.md                     # Render + Vercel deployment guide
└── docker-compose.yml
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Pinecone account and API key
- A Google Gemini API key
- Redis (optional — embedding cache)

### 1. Clone the repository

```bash
git clone https://github.com/jaicod11/DeepContext-Engine.git
cd DeepContext-Engine
```

### 2. Set up the backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate          # macOS/Linux
# venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Optional: local cross-encoder reranking (adds ~450MB — torch)
pip install -r requirements-reranker.txt

# Configure environment — create backend/.env (see Configuration below)
```

### 3. Start Redis (optional)

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

### 4. Start the backend

```bash
uvicorn app.main:app --reload --port 8000
```

Tables are created automatically on startup. With no `DATABASE_URL` set you get a local SQLite file at `backend/deepcontext.db`.

### 5. Set up the frontend

```bash
cd ../frontend
npm install
npm run dev
```

Open **http://localhost:5173**, then **register an account** on the login screen. There is no shared API key — every user signs up and receives a JWT, and all documents and chats are scoped to that account.

---

## ⚙️ Configuration

### Backend `.env`

```dotenv
ENVIRONMENT=development
SECRET_KEY=your-secret-key-here          # REQUIRED in production

# List-valued settings (ALLOWED_ORIGINS, LLM_FALLBACK_CHAIN, API_KEYS) accept
# EITHER comma-separated values OR a JSON array. They are declared as `str` in
# config.py and split by _parse_list_env(), which tries JSON first and falls
# back to comma-splitting — so a bare value pasted into a hosting dashboard
# works, and existing JSON-array .env files keep working unchanged.
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
# ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:5173"]   # also valid

# Database — omit for local SQLite
# DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname

PINECONE_API_KEY=your-pinecone-api-key
PINECONE_ENVIRONMENT=us-east-1-aws
PINECONE_INDEX_NAME=rag-index
PINECONE_DIMENSION=3072

GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.5-flash
EMBEDDING_MODEL=gemini-embedding-001
LLM_FALLBACK_CHAIN=gemini:gemini-3.5-flash,gemini:gemini-2.5-flash,gemini:gemini-3-flash

RETRIEVAL_TOP_K=30
RERANKER_TOP_N=8
SIMILARITY_SCORE_THRESHOLD=0.3
RERANKER_ENABLED=True                    # False on <1GB instances

REDIS_URL=redis://localhost:6379/0
```

### Frontend `.env`

```dotenv
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

> ⚠️ **Never commit `.env` files.** They are listed in `.gitignore`.
> Anything prefixed `VITE_` is inlined into the public client bundle — never put
> a secret there.

---

## 📡 API Reference

Interactive docs at **http://localhost:8000/docs** (disabled in production).

### Authentication

Register or log in, then send the returned JWT on every request:

```
Authorization: Bearer <access_token>
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/auth/register` | Create an account, returns JWT |
| `POST` | `/api/v1/auth/login` | Authenticate, returns JWT |
| `GET` | `/api/v1/auth/me` | Current user profile |
| `PATCH` | `/api/v1/auth/me` | Update display name |
| `GET` | `/api/v1/documents` | List your documents |
| `POST` | `/api/v1/documents/upload` | Upload a file |
| `POST` | `/api/v1/documents/text` | Ingest raw text |
| `DELETE` | `/api/v1/documents/{id}` | Delete a document |
| `GET` | `/api/v1/documents/stats` | Index statistics |
| `POST` | `/api/v1/query` | Single-turn RAG (blocking or SSE stream) |
| `POST` | `/api/v1/query/chat` | Multi-turn conversational RAG |
| `GET` | `/api/v1/chat-sessions` | List your chat sessions |
| `GET` | `/api/v1/chat-sessions/{doc_id}` | Fetch one session |
| `PUT` | `/api/v1/chat-sessions/{doc_id}` | Create or replace a session |
| `DELETE` | `/api/v1/chat-sessions/{doc_id}` | Delete one session |
| `DELETE` | `/api/v1/chat-sessions` | Clear all your sessions |
| `GET` | `/health` | Health check (no auth) |

#### Example query request

```json
{
  "question": "What are the payment terms in the contract?",
  "top_k": 30,
  "top_n": 8,
  "stream": false
}
```

#### Example response

```json
{
  "answer": "Payment terms require invoices within 30 days [SOURCE 1].",
  "sources": [{"index": 1, "source": "contract.pdf", "score": 0.98}],
  "latency_ms": 2431,
  "reranked": true,
  "model": "gemini:gemini-3.5-flash"
}
```

`reranked` and `model` report what actually served the request — useful for
confirming whether Stage 2 ran and which tier of the fallback chain answered.

---

## 🐳 Deployment

Deployed as:

| Component | Platform |
|---|---|
| Backend (FastAPI) | **Render** |
| Frontend (React) | **Vercel** |
| Database (Postgres) | **Neon** |
| Cache (Redis) | **Upstash** |

📖 **See [DEPLOYMENT.md](DEPLOYMENT.md) for the full guide**, including the three
things that will break a free-tier deploy: ephemeral SQLite, an unset
`SECRET_KEY`, and the reranker's memory footprint on 512MB instances.

### Docker Compose (local, all-in-one)

```bash
# Create backend/.env and frontend/.env first (see Configuration)
docker compose up --build
# Open http://localhost
```

### Production settings

| Setting | Development | Production |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` |
| `SECRET_KEY` | optional | **required** (app refuses to boot without it) |
| `DATABASE_URL` | unset (SQLite) | **managed Postgres** |
| `LOG_JSON` | `False` | `True` |
| Swagger UI | ✅ | ❌ |

---

## 🧪 Running Tests

```bash
cd backend
pip install -r requirements-dev.txt

# Unit tests — fully mocked, no external services required
pytest tests/unit/ -v
```

Integration tests hit the real stack, so they need more than the flag:

```bash
# Requires: Redis on localhost:6379, plus valid Pinecone + Gemini credentials
docker run -d -p 6379:6379 redis:7-alpine
INTEGRATION_TESTS=1 pytest tests/integration/ -v
```

Without Redis running, the document-ingestion and stats tests fail on a
connection error, and `TestLivePipeline` additionally needs Pinecone
credentials with access to the configured index.

---

## 🗺️ Roadmap

- [ ] **Hybrid retrieval** — BM25 sparse vectors alongside dense ANN (encoder is
      implemented but not yet fitted against a corpus, so the path is dormant)
- [ ] **Hosted reranking API** — run Stage 2 in production without torch in memory
- [ ] **Adaptive chunking** — semantic chunking instead of fixed character splits
- [ ] **Query rewriting** — HyDE (Hypothetical Document Embeddings) for better recall
- [ ] **Multi-agent workflows** — decompose complex questions into sub-queries
- [ ] **Knowledge graph integration** — entity-aware retrieval with Neo4j
- [ ] **Evaluation framework** — RAGAS metrics (faithfulness, relevancy, context recall)

### Shipped

- [x] **User authentication** — JWT multi-user support with per-user namespaces
- [x] **Ollama integration** — local model provider + fallback-chain tier
- [x] **Server-side chat history** — sessions sync across devices
- [x] **Multi-document comparison** — query across 2–3 documents at once
- [x] **Light / dark theme**
- [x] **PostgreSQL support** — same codebase runs on SQLite or Postgres

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests
4. Run the test suite: `pytest tests/unit/`
5. Push and open a pull request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with ❤️ using FastAPI, React, Pinecone, and Gemini

**DeepContext Engine** — because context is everything.

</div>
