"""
services/llm_service.py
------------------------
Provider-agnostic LLM abstraction for Gemini and Ollama, with
configurable cross-provider FALLBACK CHAIN.

FALLBACK CHAIN
---------------
Set LLM_FALLBACK_CHAIN in .env as a JSON array of "provider:model"
entries, tried in order until one succeeds:

    LLM_FALLBACK_CHAIN=["gemini:gemini-3.5-flash","gemini:gemini-2.5-flash","gemini:gemini-3-flash","ollama:llama3"]

Each entry already retries transient errors internally (3 attempts,
exponential backoff — see GeminiLLM/OllamaLLM below) before LLMService
gives up on that tier and advances to the next one. Only after EVERY
tier in the chain has failed does the final exception propagate.

Gemini tiers are near-zero-cost to try in sequence — each has its OWN
independent free-tier quota, so falling back to a different Gemini
model isn't just "trying something more stable", it's tapping a
completely separate rate-limit bucket. The optional trailing Ollama
tier is a true last-resort: if your entire Gemini API key is exhausted
or Google's API is down, a locally-running model keeps the app
answering with zero dependency on any external service.

If LLM_FALLBACK_CHAIN is not set (or is an empty list), behavior is
identical to before this feature existed: a single backend built from
LLM_PROVIDER + GEMINI_MODEL/OLLAMA_MODEL. This feature is fully
opt-in and backward compatible.

HISTORICAL FIXES (still in effect):
  FIX 1: ChatGoogleGenerativeAI now receives google_api_key explicitly.
  FIX 2: GeminiLLM stores gemini_api_key for use in get_langchain_llm().
  FIX 3: stream() iterates Gemini chunks inside asyncio.to_thread.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from app.core.config import LLMProvider, Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ─────────────────────────────────────────────
# Shared retry classifier
# ─────────────────────────────────────────────

def _is_transient(err: Exception) -> bool:
    """503 (overloaded), 429 (rate limit), 500, connection hiccups — worth retrying."""
    msg = str(err).lower()
    return any(s in msg for s in (
        "503", "unavailable", "overload", "429", "resource_exhausted",
        "500", "timeout", "connection",
    ))


# ─────────────────────────────────────────────
# Gemini backend
# Takes an explicit model_name so multiple GeminiLLM instances
# (one per fallback tier) can share the same API key but target
# different models.
# ─────────────────────────────────────────────

class GeminiLLM:
    def __init__(self, settings: Settings, model_name: str | None = None) -> None:
        from google import genai
        from google.genai import types
        self._client         = genai.Client(api_key=settings.gemini_api_key)
        self._model_name     = model_name or settings.gemini_model
        self._temperature    = settings.gemini_temperature
        self._max_tokens     = settings.gemini_max_output_tokens
        self._types          = types
        self._gemini_api_key = settings.gemini_api_key

    @property
    def label(self) -> str:
        return f"gemini:{self._model_name}"

    def _config(self):
        return self._types.GenerateContentConfig(
            temperature=self._temperature,
            max_output_tokens=self._max_tokens,
        )

    async def generate(self, prompt: str) -> str:
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                response = await asyncio.to_thread(
                    self._client.models.generate_content,
                    model=self._model_name,
                    contents=prompt,
                    config=self._config(),
                )
                return response.text
            except Exception as e:
                if _is_transient(e) and attempt < 2:
                    wait = 2 ** attempt  # 1s, 2s
                    logger.warning(
                        "llm_generate_retry", model=self.label,
                        attempt=attempt + 1, wait_seconds=wait, error=str(e)[:150],
                    )
                    await asyncio.sleep(wait)
                    last_err = e
                    continue
                raise
        raise last_err  # type: ignore[misc]

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """
        Stream tokens from Gemini, with retry on transient failures.
        Retry is safe here because it happens BEFORE any tokens are
        yielded — Gemini overload (503) fails at connection setup,
        not mid-stream.
        """
        def _collect_chunks() -> list[str]:
            chunks = []
            for chunk in self._client.models.generate_content_stream(
                model=self._model_name,
                contents=prompt,
                config=self._config(),
            ):
                if chunk.text:
                    chunks.append(chunk.text)
            return chunks

        last_err: Exception | None = None
        tokens: list[str] | None = None

        for attempt in range(3):
            try:
                tokens = await asyncio.to_thread(_collect_chunks)
                break
            except Exception as e:
                if _is_transient(e) and attempt < 2:
                    wait = 2 ** attempt
                    logger.warning(
                        "llm_stream_retry", model=self.label,
                        attempt=attempt + 1, wait_seconds=wait, error=str(e)[:150],
                    )
                    await asyncio.sleep(wait)
                    last_err = e
                    continue
                raise

        if tokens is None:
            raise last_err  # type: ignore[misc]

        for token in tokens:
            yield token

    def get_langchain_llm(self):
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=self._model_name,
            temperature=self._temperature,
            max_output_tokens=self._max_tokens,
            google_api_key=self._gemini_api_key,
        )


# ─────────────────────────────────────────────
# Ollama backend
# Same explicit-model-name pattern, plus a short retry
# (local server can be mid-restart, briefly unreachable, etc.)
# ─────────────────────────────────────────────

class OllamaLLM:
    def __init__(self, settings: Settings, model_name: str | None = None) -> None:
        import ollama
        self._client      = ollama.AsyncClient(host=str(settings.ollama_base_url))
        self._model       = model_name or settings.ollama_model
        self._temperature = settings.ollama_temperature

    @property
    def label(self) -> str:
        return f"ollama:{self._model}"

    async def generate(self, prompt: str) -> str:
        last_err: Exception | None = None
        for attempt in range(2):  # local server — fail fast if not running
            try:
                response = await self._client.generate(
                    model=self._model,
                    prompt=prompt,
                    options={"temperature": self._temperature},
                )
                return response["response"]
            except Exception as e:
                if _is_transient(e) and attempt < 1:
                    logger.warning(
                        "llm_generate_retry", model=self.label,
                        attempt=attempt + 1, error=str(e)[:150],
                    )
                    await asyncio.sleep(1)
                    last_err = e
                    continue
                raise
        raise last_err  # type: ignore[misc]

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        async for part in await self._client.generate(
            model=self._model,
            prompt=prompt,
            options={"temperature": self._temperature},
            stream=True,
        ):
            if part.get("response"):
                yield part["response"]

    def get_langchain_llm(self):
        from langchain_community.llms import Ollama
        return Ollama(model=self._model, temperature=self._temperature)


# ─────────────────────────────────────────────
# Fallback chain resolution
# ─────────────────────────────────────────────

def _resolve_chain_entries(settings: Settings) -> list[str]:
    """
    Reads settings.llm_fallback_chain_list (parsed from LLM_FALLBACK_CHAIN
    in .env, comma-separated or a JSON array).

    Falls back to a single-entry chain built from the existing
    LLM_PROVIDER + model settings if the list is empty.
    """
    entries = list(settings.llm_fallback_chain_list)
    if entries:
        return entries
    provider = settings.llm_provider.value
    model = settings.active_llm_model
    return [f"{provider}:{model}"]


def _build_backend(entry: str, settings: Settings):
    """Build one backend instance from a 'provider:model' string."""
    if ":" not in entry:
        raise ValueError(f"Invalid fallback chain entry (expected 'provider:model'): {entry!r}")
    provider, model_name = entry.split(":", 1)
    provider = provider.strip().lower()
    model_name = model_name.strip()

    if provider == "gemini":
        return GeminiLLM(settings, model_name=model_name)
    elif provider == "ollama":
        return OllamaLLM(settings, model_name=model_name)
    else:
        raise ValueError(f"Unknown provider '{provider}' in fallback chain entry: {entry!r}")


# ─────────────────────────────────────────────
# Unified facade with fallback
# ─────────────────────────────────────────────

class LLMService:
    """
    Tries each backend in the configured fallback chain, in order.
    Each backend already retries transient errors internally; LLMService
    only advances to the next tier once a given backend's own retries
    are exhausted.

    last_used_model reflects which backend actually answered the most
    recent request — useful for logging/debugging which tier is
    actually serving traffic.

    get_langchain_llm() returns the PRIMARY (first) backend's LangChain
    wrapper. RAGChain now calls generate()/stream() directly instead of
    LangChain's .ainvoke(), so this method is kept for compatibility
    but no longer sits on the hot path — only generate()/stream() get
    full fallback coverage.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        s = settings or get_settings()
        chain_entries = _resolve_chain_entries(s)

        self._backends = []
        for entry in chain_entries:
            try:
                backend = _build_backend(entry, s)
                self._backends.append(backend)
            except Exception as e:
                logger.error("llm_backend_init_failed", entry=entry, error=str(e))

        if not self._backends:
            raise RuntimeError(
                "No usable LLM backends could be initialised. "
                "Check LLM_FALLBACK_CHAIN / LLM_PROVIDER settings."
            )

        self.last_used_model: str | None = None

        logger.info(
            "llm_service_ready",
            chain=[b.label for b in self._backends],
            primary=self._backends[0].label,
            tiers=len(self._backends),
        )

    async def generate(self, prompt: str) -> str:
        logger.debug("llm_generate", chars=len(prompt))
        last_err: Exception | None = None
        for i, backend in enumerate(self._backends):
            try:
                result = await backend.generate(prompt)
                self.last_used_model = backend.label
                if i > 0:
                    logger.warning("llm_fallback_used", used_model=backend.label, tier=i + 1)
                logger.debug("llm_generate_done", response_chars=len(result), model=backend.label)
                return result
            except Exception as e:
                logger.error("llm_backend_failed", model=backend.label, tier=i + 1, error=str(e)[:200])
                last_err = e
                continue
        raise last_err  # type: ignore[misc]

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """
        Tries each backend in the chain. Tokens from a given backend are
        fully buffered before any are yielded out — this is what makes
        cross-tier fallback SAFE: if tier 1 fails partway through
        generating, nothing has been sent to the client yet, so we can
        cleanly retry the whole prompt on tier 2 without risking
        duplicated or interleaved output.
        """
        logger.debug("llm_stream_start", chars=len(prompt))
        last_err: Exception | None = None
        for i, backend in enumerate(self._backends):
            try:
                tokens: list[str] = []
                async for token in backend.stream(prompt):
                    tokens.append(token)
                self.last_used_model = backend.label
                if i > 0:
                    logger.warning("llm_fallback_used", used_model=backend.label, tier=i + 1)
                for token in tokens:
                    yield token
                return
            except Exception as e:
                logger.error("llm_backend_failed", model=backend.label, tier=i + 1, error=str(e)[:200])
                last_err = e
                continue
        raise last_err  # type: ignore[misc]

    def get_langchain_llm(self):
        return self._backends[0].get_langchain_llm()


_llm_instance: LLMService | None = None


def get_llm_service() -> LLMService:
    global _llm_instance
    if _llm_instance is None:
        _llm_instance = LLMService()
    return _llm_instance