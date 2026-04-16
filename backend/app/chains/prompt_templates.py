"""
chains/prompt_templates.py
--------------------------
All LangChain prompt templates used in the RAG pipeline.

Design principles:
  • System prompt enforces citation discipline — the LLM must ground every
    claim in a retrieved chunk and cite [SOURCE N] inline.
  • Separate templates for QA, summarisation, and follow-up queries so the
    chain can be specialised without changing business logic.
  • Jinja2-style variables are avoided; we use LangChain's {variable} syntax
    which is compatible with ChatPromptTemplate and PromptTemplate alike.
"""

from __future__ import annotations

from langchain_core.prompts import (
    ChatPromptTemplate,
    HumanMessagePromptTemplate,
    PromptTemplate,
    SystemMessagePromptTemplate,
)

# ─────────────────────────────────────────────
# System prompt — core RAG QA
# ─────────────────────────────────────────────

_RAG_SYSTEM = """\
You are a precise, citation-driven research assistant.
Your answers are grounded exclusively in the retrieved context passages below.

RULES:
1. Answer only from the provided context. Do not use prior knowledge.
2. Cite every factual claim with [SOURCE N] where N is the passage number.
3. If the context does not contain enough information, say:
   "The provided documents do not contain sufficient information to answer this question."
4. Be concise but complete. Use bullet points for lists; prose for explanations.
5. Never fabricate citations, quotes, or statistics.
6. If multiple passages support a claim, cite all of them: [SOURCE 1][SOURCE 3].

--- RETRIEVED CONTEXT ---
{context}
--- END CONTEXT ---
"""

RAG_QA_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessagePromptTemplate.from_template(_RAG_SYSTEM),
    HumanMessagePromptTemplate.from_template("{question}"),
])

# ─────────────────────────────────────────────
# Condense + QA (for multi-turn conversations)
# ─────────────────────────────────────────────

_CONDENSE_SYSTEM = """\
Given the conversation history and the latest user question, rewrite the
question as a standalone query that can be understood without the history.
Return ONLY the rewritten question — no explanation, no preamble.
"""

CONDENSE_QUESTION_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessagePromptTemplate.from_template(_CONDENSE_SYSTEM),
    HumanMessagePromptTemplate.from_template(
        "Chat history:\n{chat_history}\n\nFollow-up question: {question}"
    ),
])

# ─────────────────────────────────────────────
# Summarisation prompt
# ─────────────────────────────────────────────

_SUMMARISE_SYSTEM = """\
You are a document summariser. Produce a structured summary of the passages below.

OUTPUT FORMAT:
## Summary
<2–3 sentence overview>

## Key Points
- <point 1> [SOURCE N]
- <point 2> [SOURCE N]
...

## Gaps / Limitations
<anything the document does not cover, or "None identified">

--- PASSAGES ---
{context}
--- END PASSAGES ---
"""

SUMMARISE_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessagePromptTemplate.from_template(_SUMMARISE_SYSTEM),
    HumanMessagePromptTemplate.from_template(
        "Summarise the above passages. Focus on: {focus}"
    ),
])

# ─────────────────────────────────────────────
# Context formatter
# ─────────────────────────────────────────────

def format_context(chunks: list[dict]) -> str:
    """
    Convert a list of retrieved chunk dicts into the numbered passage
    block injected into {context}.

    Each chunk dict should have:
        text   : str   — chunk content
        source : str   — filename or URL
        score  : float — similarity score (optional)
    """
    lines: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        source = chunk.get("source", "unknown")
        score  = chunk.get("score")
        score_str = f" (score: {score:.3f})" if score is not None else ""
        lines.append(
            f"[SOURCE {i}] {source}{score_str}\n{chunk.get('text', '').strip()}"
        )
    return "\n\n".join(lines)
