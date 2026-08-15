# Deployment Guide — Render (backend) + Vercel (frontend)

Everything here was verified against the real stack: a PostgreSQL 16 container,
a clean virtualenv install, and live requests to the running app. Where
something could **not** be verified locally it says so explicitly.

---

## 1. The two settings that will bite you

Get these wrong and the app fails in ways whose error messages point somewhere
unhelpful.

### On a 512MB instance, `RERANKER_ENABLED=False` is necessary but NOT sufficient

`reranker_enabled` **defaults to `True`** (`app/core/config.py`). Left on, the
first query loads a `sentence-transformers` CrossEncoder, which pulls in `torch`.
That needs well over 512MB resident and the instance is OOM-killed.

So set:

```
RERANKER_ENABLED=False
```

**But the flag alone does not keep `torch` out of memory.** The reranker's own
import *is* lazy — `app/services/reranker_service.py::_load_model()` imports
`sentence_transformers` inside the function, gated behind `if not self._enabled`.
The problem is a second, indirect path: `sentence-transformers` depends on
`transformers`, and `langchain_core.language_models.base` imports `transformers`
during the ordinary app import chain:

```
app/main.py -> api/routes/query.py -> chains/rag_chain.py
            -> chains/prompt_templates.py -> langchain_core.prompts
            -> langchain_core.language_models.base -> transformers -> torch
```

Verified with an import tracer: with `RERANKER_ENABLED=False` and the packages
installed, `'torch' in sys.modules` is **`True`** immediately after importing
`app.main`.

The packages must therefore be *absent*, which is why `requirements.txt` no
longer installs them — they live in `requirements-reranker.txt`. With them
uninstalled, the same check reports `False` and the app starts and serves
normally (verified: register / login / `/auth/me` / `GET /documents` / `/health`
all 200). Environment size drops from **1.1G to 659M**.

To enable reranking on an instance with headroom (≥2GB):

```bash
pip install -r requirements.txt -r requirements-reranker.txt
```

If the packages are absent and you leave `RERANKER_ENABLED=True`, queries fail
with a clear `RuntimeError` from `_load_model()` telling you to install
sentence-transformers — noisy, but far better than an OOM kill that takes the
whole service down.

Retrieval quality drops without reranking (it's the second stage of the
two-stage pipeline). That is the trade-off the 512MB tier forces.

### `SECRET_KEY` must be set explicitly in production

If unset, it falls back to a random value regenerated **on every process start**,
so every JWT issued before a restart or redeploy is silently invalidated and
users are bounced to the login screen with an opaque 401.

The app now refuses to start in that state rather than degrading silently:

```
SECRET_KEY is not set, but ENVIRONMENT=production.
The fallback generates a new random key on every start, which invalidates
every existing login token on each restart/redeploy.
```

Generate a stable one and set it in Render's **Environment** tab:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Keep it identical across deploys — changing it logs everyone out.

---

## 2. Database: never use SQLite in production

The default `sqlite+aiosqlite:///./deepcontext.db` writes to the container's
local disk. Free-tier filesystems are **ephemeral**: the file, and every user
account in it, is destroyed on each restart and redeploy.

Provision a managed Postgres and set `DATABASE_URL`. You can paste the provider's
URL as-is — the app normalises the scheme onto the async driver:

| What the provider gives you | What the app uses |
|---|---|
| `postgresql://user:pass@host/db` (Render) | `postgresql+asyncpg://…` |
| `postgres://user:pass@host/db` (Heroku)   | `postgresql+asyncpg://…` |
| `postgresql+asyncpg://…`                  | unchanged |
| `sqlite+aiosqlite:///./deepcontext.db`    | unchanged (local dev) |

Without that normalisation, Render's own URL selects the *sync* psycopg2 driver
and startup dies with `ModuleNotFoundError: No module named 'psycopg2'`; a
Heroku-style URL dies with `NoSuchModuleError: Can't load plugin:
sqlalchemy.dialects:postgres`.

Tables are created automatically by `init_db()` on startup — verified against
PostgreSQL 16, including the `ON DELETE CASCADE` foreign key.

**Local development is unchanged.** Set nothing and you stay on SQLite.

### Two behavioural differences vs SQLite

Neither breaks the app, but both are real:

1. **Foreign keys are enforced.** Postgres rejects a `documents` row whose
   `user_id` has no matching user (`IntegrityError`); SQLite silently accepts it
   unless `PRAGMA foreign_keys=ON`. Deleting a user now genuinely cascades.
2. **Timestamps come back timezone-aware.** `DateTime(timezone=True)` maps to
   `timestamp with time zone` and returns `tzinfo=UTC`; SQLite returns naive
   datetimes. API responses gain a `Z` suffix (`…T08:59:46.272859Z`).

---

## 3. Backend on Render

**Build command**

```bash
pip install -r requirements.txt
```

**Start command** — bind Render's injected `$PORT`, not the config default:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

**Environment variables**

```
ENVIRONMENT=production
SECRET_KEY=<stable value — see above>
DATABASE_URL=<managed Postgres URL>
RERANKER_ENABLED=False          # required at 512MB
ALLOWED_ORIGINS=https://your-frontend.vercel.app
PINECONE_API_KEY=<key>
GEMINI_API_KEY=<key>
LOG_JSON=True                   # avoids a startup warning in production
```

`ENVIRONMENT=production` also enforces `DEBUG=False` and `RELOAD=False`.

---

## 4. CORS

`ALLOWED_ORIGINS` is a **comma-separated** list. Include the exact scheme and
host of the deployed frontend:

```
ALLOWED_ORIGINS=https://your-frontend.vercel.app
ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://staging.vercel.app
```

Do not wrap it in quotes or brackets — paste the bare value into Render's
Environment tab. A JSON array (`["https://a.app","https://b.app"]`) is still
accepted for existing `.env` files, but the plain form is what a hosting
dashboard produces and is the recommended one.

The same applies to `API_KEYS` and `LLM_FALLBACK_CHAIN`. These fields are
typed as `str` in `config.py` specifically so a plain dashboard value cannot
crash startup — see the note above `_parse_list_env`.

A trailing slash is fine — `cors_origins` strips it, which matters because
browsers send `Origin` without one. Verified live: a request from
`https://deepcontext.vercel.app` is allowed while an unlisted origin gets `400`
and no `access-control-allow-origin` header.

Vercel **preview deployments use per-branch hostnames**, so previews are blocked
unless you add their URLs too.

Keep `http://localhost:5173` in the list only if you want local dev to talk to
the production backend.

---

## 5. Frontend on Vercel

Set the API base URL to the deployed backend — it defaults to `localhost:8000`,
which in production means the user's own machine:

```
VITE_API_BASE_URL=https://your-backend.onrender.com/api/v1
```

Note `frontend/.env` also contains `VITE_API_KEY`. Anything prefixed `VITE_` is
**inlined into the client bundle and publicly readable**. The backend no longer
uses a shared API key (auth is per-user JWT), so that variable should not be set
in production.

---

## 6. Free-tier cold starts

Render free instances sleep after inactivity and take ~30–60s to wake. The first
request after idling may exceed the frontend's timeout. `pool_pre_ping=True` is
enabled for Postgres so the connection pool discards sockets the provider closed
while idle — without it the first query after a sleep fails.

---

## What was NOT verified locally

- **No deploy to Render or Vercel was performed.** Build/start commands and env
  var names follow their documented behaviour but are unverified against the
  live platforms.
- **Memory ceilings were not measured.** Disk footprint was measured (1.1G vs
  659M) and the `torch`-at-startup import was proven with a tracer, but no RSS
  was sampled under load, so "exceeds 512MB" rests on torch's known footprint
  rather than a measurement on a real Render instance.
- **Cold-start timings** are not measured here.
