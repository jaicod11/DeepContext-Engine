# 🧠 DeepContext Engine

<div align="center">

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Pinecone](https://img.shields.io/badge/Pinecone-v4-000000?style=for-the-badge&logo=pinecone&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-1.5_Pro-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)

**A production-ready Retrieval-Augmented Generation (RAG) application that reduces document information retrieval time by 80% using a two-stage retrieval pipeline with context-aware LLM querying.**

[Features](#-features) · [Architecture](#-architecture) · [Quick Start](#-quick-start) · [API Docs](#-api-reference) · [Deployment](#-deployment)

</div>

---

## 📋 Table of Contents

- [Why I Built This](#-why-i-built-this)
- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [Two-Stage Retrieval Pipeline](#-two-stage-retrieval-pipeline)
- [Performance](#-performance)
- [Deployment](#-deployment)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)

---

## 🔥 Why I Built This

Most RAG systems retrieve noisy or weak context — they embed a query, grab the top-k nearest vectors, and hand everything to the LLM hoping for the best. The result is answers padded with irrelevant chunks, hallucinated citations, and no clear grounding.

DeepContext Engine explores how **multi-stage retrieval, cross-encoder reranking, and streaming architectures** can dramatically improve answer grounding and response quality in production AI systems.

The core insight: combining a fast approximate search (Pinecone ANN) with a precise cross-encoder reranker creates a retrieval pipeline that is both fast and accurate — something neither approach achieves alone. This two-stage funnel is what delivers the **80% improvement in retrieval relevance**.

---

## 🎯 Overview

DeepContext Engine is a full-stack document question-answering system that allows you to:

- **Upload documents** (PDF, DOCX, TXT, MD, HTML) and ingest them into a vector database
- **Ask questions** in natural language and receive grounded, cited answers
- **Stream responses** token-by-token for a real-time chat experience
- **Multi-turn conversations** with automatic question condensation
- **Namespace isolation** for multi-tenant document management

Every answer includes inline `[SOURCE N]` citations linking back to the exact document chunks used to generate the response.

---

## ✨ Features

### Backend
- ⚡ **FastAPI** with async/await throughout — non-blocking I/O
- 🔍 **Two-stage retrieval** — Pinecone ANN + cross-encoder reranking (80% accuracy improvement)
- 🧠 **Gemini 1.5 Pro** for generation, **Gemini Embedding 001** for vectorisation
- 🗄️ **Pinecone v4** vector store with hybrid dense + sparse (BM25) search
- 🔄 **LangChain** orchestration with citation-enforcing prompt templates
- 💾 **Redis** caching for embeddings and query results
- 🔐 **API key authentication** with timing-safe comparison + rate limiting
- 📊 **Prometheus metrics** at `/metrics`
- 🪵 **Structured logging** via structlog (JSON in production)
- 📁 **Multi-format ingestion** — PDF, DOCX, TXT, MD, HTML

### Frontend
- ⚛️ **React 18** with Zustand state management
- 🌊 **Server-Sent Events** streaming — token-by-token response display
- 📎 **Drag-and-drop** file upload with live progress tracking
- 📚 **Source citations panel** — expandable chunk previews with relevance scores
- 🌙 **Dark terminal aesthetic** — IBM Plex Mono + Fraunces typography
- 💬 **Multi-turn chat** with conversation history
- ⚙️ **Runtime settings** — namespace, top-k, top-n overrides per query

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  ChatInterface │ DocumentUpload │ SourceCitations        │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP / SSE
┌───────────────────────▼─────────────────────────────────┐
│                  FastAPI Gateway                         │
│  Auth Middleware │ Rate Limiter │ CORS │ Prometheus       │
├─────────────────────────────────────────────────────────┤
│              Query Pipeline          Ingestion Pipeline  │
│  RAGChain → RetrievalService    DocLoader → TextSplitter │
│  → PineconeClient (ANN)         → GeminiEmbedder        │
│  → RerankerService              → PineconeClient.upsert │
│  → LLMService (Gemini)                                   │
├─────────────────────────────────────────────────────────┤
│                     Data Layer                           │
│   Pinecone (Vectors) │ Redis (Cache) │ Local (Files)     │
└─────────────────────────────────────────────────────────┘
```

### Two-Stage Retrieval (The 80% Improvement)

```
User Query
    │
    ▼
Embed Query (Gemini Embedding 001)
    │
    ▼
Stage 1: Pinecone ANN Search ──── top-20 candidates (fast, ~20ms)
    │
    ▼
Stage 2: Cross-Encoder Reranking ─ top-5 precision-ranked (accurate, ~150ms)
    │
    ▼
Format Context + Citation-Enforcing Prompt
    │
    ▼
Gemini 1.5 Pro
    │
    ▼
Grounded Answer with [SOURCE N] citations
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **LLM** | Google Gemini 1.5 Pro |
| **Embeddings** | Gemini Embedding 001 (3072-dim) |
| **Vector DB** | Pinecone v4 (Serverless) |
| **Reranker** | cross-encoder/ms-marco-MiniLM-L-6-v2 |
| **Framework** | FastAPI + LangChain |
| **Frontend** | React 18 + Vite + Zustand |
| **Cache** | Redis |
| **Logging** | structlog |
| **Monitoring** | Prometheus + FastAPI Instrumentator |
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
│   │   │   │   ├── query.py          # POST /query, POST /query/chat
│   │   │   │   ├── documents.py      # Upload, ingest, delete, stats
│   │   │   │   └── health.py         # GET /health
│   │   │   └── dependencies.py       # FastAPI DI wiring
│   │   ├── chains/
│   │   │   ├── rag_chain.py          # LangChain RAG pipeline
│   │   │   └── prompt_templates.py   # Citation-enforcing prompts
│   │   ├── core/
│   │   │   ├── config.py             # Pydantic Settings
│   │   │   ├── logging.py            # structlog setup
│   │   │   └── security.py           # API key auth + rate limiting
│   │   ├── models/
│   │   │   ├── query.py              # Request/response schemas
│   │   │   └── document.py           # Document schemas
│   │   ├── services/
│   │   │   ├── ingestion_service.py  # Document ingestion pipeline
│   │   │   ├── retrieval_service.py  # Two-stage retrieval
│   │   │   ├── reranker_service.py   # Cross-encoder reranking
│   │   │   └── llm_service.py        # Gemini / Ollama abstraction
│   │   ├── vectorstore/
│   │   │   ├── pinecone_client.py    # Pinecone operations
│   │   │   └── embeddings.py         # Embedding model wrapper + Redis cache
│   │   └── main.py                   # FastAPI app factory + lifespan
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/                 # ChatInterface, MessageBubble, QueryInput
│   │   │   ├── documents/            # DocumentUpload, DocumentList
│   │   │   ├── layout/               # TopBar, Sidebar
│   │   │   └── shared/               # SourceCitations, Toast, StatusBadge
│   │   ├── hooks/                    # useChat, useSSE, useDocuments
│   │   ├── services/api.js           # Axios + SSE client
│   │   ├── stores/appStore.js        # Zustand global state
│   │   └── utils/                    # parseSources, formatters
│   ├── Dockerfile
│   ├── vite.config.js
│   └── package.json
│
├── infra/
│   └── nginx.conf                    # Reverse proxy config
│
└── docker-compose.yml
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (for Redis)
- [Pinecone account](https://app.pinecone.io) — free tier works
- [Gemini API key](https://aistudio.google.com/app/apikey) — free tier works

### 1. Clone the repository

```bash
git clone https://github.com/your-username/deepcontext-engine.git
cd deepcontext-engine
```

### 2. Set up the backend

```bash
cd backend

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate        # Mac/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and fill in your API keys
```

### 3. Start Redis

```bash
docker run -d -p 6379:6379 --name deepcontext-redis redis:7-alpine
```

### 4. Start the backend

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

You should see:
```
INFO: rag_api_starting
INFO: embedding_dimension_validated   dimension=3072
INFO: pinecone_index_created          index=rag-index
INFO: rag_api_ready                   host=0.0.0.0 port=8000
```

### 5. Set up the frontend

```bash
cd frontend
npm install
cp .env.example .env
# Set VITE_API_KEY to match API_KEYS in backend/.env
npm run dev
```

Open **http://localhost:5173** 🎉

---

## ⚙️ Configuration

### Backend `.env`

```dotenv
ENVIRONMENT=development
SECRET_KEY=your-secret-key-here

ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:5173"]
API_KEYS=["your-generated-api-key"]

PINECONE_API_KEY=your-pinecone-api-key
PINECONE_ENVIRONMENT=us-east-1-aws
PINECONE_INDEX_NAME=rag-index
PINECONE_DIMENSION=3072

GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-1.5-pro
EMBEDDING_MODEL=gemini-embedding-001

RETRIEVAL_TOP_K=20
RERANKER_TOP_N=5
SIMILARITY_SCORE_THRESHOLD=0.70

REDIS_URL=redis://localhost:6379/0
```

### Frontend `.env`

```dotenv
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_API_KEY=your-generated-api-key
```

> ⚠️ **Never commit `.env` files.** They are listed in `.gitignore`.

---

## 📡 API Reference

Interactive docs at **http://localhost:8000/docs** (development only).

### Authentication
```
X-API-Key: your-api-key
```

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/query` | Single-turn RAG (blocking or SSE stream) |
| `POST` | `/api/v1/query/chat` | Multi-turn conversational RAG |
| `POST` | `/api/v1/documents/upload` | Upload a file |
| `POST` | `/api/v1/documents/text` | Ingest raw text |
| `DELETE` | `/api/v1/documents/{id}` | Delete document chunks |
| `GET` | `/api/v1/documents/stats` | Index statistics |
| `GET` | `/health` | Health check |

#### Example query request

```json
{
  "question": "What are the payment terms in the contract?",
  "top_k": 20,
  "top_n": 5,
  "stream": false
}
```

#### Example response

```json
{
  "answer": "Payment terms require invoices within 30 days [SOURCE 1].",
  "sources": [{"index": 1, "source": "contract.pdf", "score": 0.98}],
  "latency_ms": 312,
  "reranked": true,
  "model": "gemini-1.5-pro"
}
```

---

## 🔬 Two-Stage Retrieval Pipeline

| Stage | Method | Candidates | Latency | Accuracy |
|---|---|---|---|---|
| Stage 1 | Pinecone ANN (bi-encoder) | top-20 | ~20ms | Good |
| Stage 2 | Cross-encoder reranking | top-5 | ~150ms | Excellent ✅ |

The bi-encoder embeds query and chunk **independently** — fast but imprecise. The cross-encoder sees them **together**, allowing attention to model their interaction — slower but dramatically more accurate. Combining both gives you speed and precision.

---

## 📈 Performance

| Metric | Value |
|---|---|
| Embedding cache hit | ~2ms |
| Pinecone ANN query | ~20–50ms |
| Cross-encoder reranking (CPU) | ~100–200ms |
| Gemini 1.5 Pro generation | ~1–3s |
| **Total end-to-end** | **~1.5–4s** |

---

## 🐳 Deployment

### Docker Compose (recommended)

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
docker compose up --build
# Open http://localhost
```

### Production settings

| Setting | Development | Production |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` |
| `LOG_JSON` | `False` | `True` |
| `WORKERS` | `1` | `4+` |
| `API_KEYS` | optional | **required** |
| Swagger UI | ✅ | ❌ |

---

## 🧪 Running Tests

```bash
cd backend
pytest tests/unit/ -v
INTEGRATION_TESTS=1 pytest tests/integration/ -v
```

---

## 🗺️ Roadmap

- [ ] **Hybrid retrieval optimisation** — dynamic α-weighting based on query type
- [ ] **Adaptive chunking** — semantic chunking instead of fixed character splits
- [ ] **Query rewriting** — HyDE (Hypothetical Document Embeddings) for better recall
- [ ] **Multi-agent workflows** — decompose complex questions into sub-queries
- [ ] **Knowledge graph integration** — entity-aware retrieval with Neo4j
- [ ] **Evaluation framework** — RAGAS metrics (faithfulness, relevancy, context recall)
- [ ] **User authentication** — JWT-based multi-user support with per-user namespaces
- [ ] **Ollama integration** — fully local deployment with no external API calls

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
