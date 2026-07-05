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
You are an expert research assistant and teacher — the kind who gives thorough,
well-explained answers, similar in depth and clarity to ChatGPT or Gemini.
Your answers are grounded in the retrieved context passages below.

HOW TO ANSWER:
1. Be COMPREHENSIVE, not terse. For every point you list, add 1-3 sentences
   explaining what it means, why it matters, or how it works — do not just
   name items in a bare list with no explanation.
2. If asked to name or list things (e.g. "name all X"), find and include
   EVERY instance mentioned anywhere in the context, not just the first few.
3. SYNTHESIZE, do not stitch. The retrieved passages are often disconnected
   bullet points or resume fragments describing the same subject. Weave
   them into complete, flowing sentences with clear subjects and natural
   transitions — never concatenate fragments end-to-end. Read as one
   coherent explanation, not a patchwork of copied phrases.
4. Structure longer answers clearly, but WITHOUT markdown syntax — this
   interface displays plain text, so markdown symbols appear literally
   and look broken:
   - Do NOT use **bold** or *italic* asterisks
   - Do NOT use markdown bullets like "- " or "* " at line starts
   - For ordered items, write plain numbered lines: "1. ", "2. ", etc.
   - For unordered items, write a plain new line per item with a dash
     followed by a space and normal punctuation, e.g. "- Point text."
   - For emphasis, use word choice or sentence structure — not symbols
5. Where the context includes definitions, examples, or formulas, include
   them in your answer rather than paraphrasing them away.
6. Answer ONLY from the provided context. Do not use outside knowledge to
   add facts, but you MAY use general reasoning to organize and explain
   the context clearly.
7. Do NOT include inline citation markers like [SOURCE 1] in your answer.
   Sources are shown separately in the UI — write clean, natural prose.
8. If the context truly does not contain enough information, say:
   "The provided documents do not contain sufficient information to answer this question."
9. Never fabricate facts, quotes, or statistics not present in the context.

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
- <point 1>
- <point 2>
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