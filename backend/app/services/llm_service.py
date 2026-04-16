"""
services/llm_service.py
------------------------
Provider-agnostic LLM abstraction for Gemini and Ollama.

FIX 1: ChatGoogleGenerativeAI now receives google_api_key explicitly
        (previously relied on GOOGLE_API_KEY env var which we don't set;
        we set GEMINI_API_KEY instead).

FIX 2: GeminiLLM stores gemini_api_key for use in get_langchain_llm().

FIX 3: stream() iterates Gemini chunks inside asyncio.to_thread to avoid
        blocking the event loop between chunks.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from app.core.config import LLMProvider, Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ─────────────────────────────────────────────
# Gemini
# ─────────────────────────────────────────────

class GeminiLLM:
    def __init__(self, settings: Settings) -> None:
        from google import genai
        from google.genai import types
        self._client         = genai.Client(api_key=settings.gemini_api_key)
        self._model_name     = settings.gemini_model
        self._temperature    = settings.gemini_temperature
        self._max_tokens     = settings.gemini_max_output_tokens
        self._types          = types
        # ── FIX: store key for langchain client ──
        self._gemini_api_key = settings.gemini_api_key

    def _config(self):
        return self._types.GenerateContentConfig(
            temperature=self._temperature,
            max_output_tokens=self._max_tokens,
        )

    async def generate(self, prompt: str) -> str:
        response = await asyncio.to_thread(
            self._client.models.generate_content,
            model=self._model_name,
            contents=prompt,
            config=self._config(),
        )
        return response.text

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """
        Stream tokens from Gemini.
        Collects all chunks in a thread to avoid blocking the event loop,
        then yields them back to the async caller.
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

        tokens = await asyncio.to_thread(_collect_chunks)
        for token in tokens:
            yield token

    def get_langchain_llm(self):
        from langchain_google_genai import ChatGoogleGenerativeAI
        # ── FIX: pass google_api_key explicitly ──
        return ChatGoogleGenerativeAI(
            model=self._model_name,
            temperature=self._temperature,
            max_output_tokens=self._max_tokens,
            google_api_key=self._gemini_api_key,
        )


# ─────────────────────────────────────────────
# Ollama
# ─────────────────────────────────────────────

class OllamaLLM:
    def __init__(self, settings: Settings) -> None:
        import ollama
        self._client      = ollama.AsyncClient(host=str(settings.ollama_base_url))
        self._model       = settings.ollama_model
        self._temperature = settings.ollama_temperature

    async def generate(self, prompt: str) -> str:
        response = await self._client.generate(
            model=self._model,
            prompt=prompt,
            options={"temperature": self._temperature},
        )
        return response["response"]

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
# Unified facade
# ─────────────────────────────────────────────

class LLMService:
    def __init__(self, settings: Settings | None = None) -> None:
        s = settings or get_settings()
        if s.llm_provider == LLMProvider.GEMINI:
            self._backend = GeminiLLM(s)
        elif s.llm_provider == LLMProvider.OLLAMA:
            self._backend = OllamaLLM(s)
        else:
            raise ValueError(f"Unsupported LLM provider: {s.llm_provider}")
        self._provider = s.llm_provider
        logger.info("llm_service_ready", provider=s.llm_provider.value, model=s.active_llm_model)

    async def generate(self, prompt: str) -> str:
        logger.debug("llm_generate", chars=len(prompt))
        result = await self._backend.generate(prompt)
        logger.debug("llm_generate_done", response_chars=len(result))
        return result

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        logger.debug("llm_stream_start", chars=len(prompt))
        async for token in self._backend.stream(prompt):
            yield token

    def get_langchain_llm(self):
        return self._backend.get_langchain_llm()


_llm_instance: LLMService | None = None


def get_llm_service() -> LLMService:
    global _llm_instance
    if _llm_instance is None:
        _llm_instance = LLMService()
    return _llm_instance
