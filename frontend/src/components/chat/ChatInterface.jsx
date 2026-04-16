/**
 * components/chat/ChatInterface.jsx
 * ------------------------------------
 * Main chat shell.
 *
 * Responsibilities:
 *   • Render the scrollable message list
 *   • Auto-scroll to bottom on new messages / streaming tokens
 *   • Empty state with example prompts
 *   • Compose area (QueryInput)
 */

import { useEffect, useRef, useCallback } from "react";
import { Database, FileSearch, Sparkles, BookOpen } from "lucide-react";
import { useChat }     from "@/hooks/useChat";
import MessageBubble   from "./MessageBubble";
import QueryInput      from "./QueryInput";

/* ── Example prompts shown in empty state ────────────────────────── */
const EXAMPLE_PROMPTS = [
  {
    icon:  <FileSearch size={15} />,
    label: "Summarise key terms",
    text:  "What are the key terms and definitions in this document?",
  },
  {
    icon:  <Database size={15} />,
    label: "Extract data points",
    text:  "List all numeric figures, dates, and deadlines mentioned.",
  },
  {
    icon:  <BookOpen size={15} />,
    label: "Find obligations",
    text:  "What obligations does each party have under this agreement?",
  },
  {
    icon:  <Sparkles size={15} />,
    label: "Risk analysis",
    text:  "What are the potential risks or ambiguous clauses I should be aware of?",
  },
];

/* ── Empty state ─────────────────────────────────────────────────── */
function EmptyState({ onPromptClick, onUploadClick }) {
  return (
    <div style={{
      flex:           1,
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
      padding:        "40px 24px",
      textAlign:      "center",
    }}>
      {/* Logo mark */}
      <div style={{
        width:        56,
        height:       56,
        borderRadius: "var(--radius-lg)",
        background:   "var(--bg-surface)",
        border:       "1px solid var(--bg-border)",
        display:      "flex",
        alignItems:   "center",
        justifyContent: "center",
        marginBottom: 20,
      }}>
        <span style={{
          fontFamily:   "var(--font-display)",
          fontStyle:    "italic",
          fontWeight:   300,
          fontSize:     24,
          color:        "var(--accent)",
          letterSpacing: "-0.03em",
        }}>
          R
        </span>
      </div>

      <h1 style={{
        fontFamily:   "var(--font-display)",
        fontStyle:    "italic",
        fontWeight:   300,
        fontSize:     26,
        color:        "var(--text-primary)",
        letterSpacing: "-0.02em",
        marginBottom: 8,
      }}>
        Document Intelligence
      </h1>

      <p style={{
        fontSize:    12,
        color:       "var(--text-tertiary)",
        fontFamily:  "var(--font-mono)",
        marginBottom: 32,
        maxWidth:    360,
        lineHeight:  1.7,
      }}>
        Upload documents and ask questions. Every answer is grounded in your files with inline citations.
      </p>

      {/* Example prompt grid */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap:                 8,
        width:               "100%",
        maxWidth:            480,
        marginBottom:        24,
      }}>
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p.label}
            onClick={() => onPromptClick(p.text)}
            style={{
              display:      "flex",
              alignItems:   "flex-start",
              gap:          8,
              padding:      "10px 12px",
              background:   "var(--bg-surface)",
              border:       "1px solid var(--bg-border)",
              borderRadius: "var(--radius-md)",
              textAlign:    "left",
              cursor:       "pointer",
              transition:   "border-color 150ms, background 150ms",
              color:        "var(--text-tertiary)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent-dim)";
              e.currentTarget.style.background  = "var(--accent-muted)";
              e.currentTarget.style.color        = "var(--text-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--bg-border)";
              e.currentTarget.style.background  = "var(--bg-surface)";
              e.currentTarget.style.color        = "var(--text-tertiary)";
            }}
          >
            <span style={{ marginTop: 1, flexShrink: 0 }}>{p.icon}</span>
            <div>
              <div style={{
                fontSize:   12,
                fontFamily: "var(--font-mono)",
                fontWeight: 500,
                color:      "inherit",
                marginBottom: 2,
              }}>
                {p.label}
              </div>
              <div style={{
                fontSize:   11,
                color:      "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
                lineHeight: 1.5,
              }}>
                {p.text.length > 60 ? p.text.slice(0, 57) + "…" : p.text}
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={onUploadClick}
        style={{
          fontSize:   11,
          color:      "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
          textDecoration: "underline",
          cursor:     "pointer",
          textUnderlineOffset: 3,
        }}
      >
        Upload your first document →
      </button>
    </div>
  );
}

/* ── Scroll-to-bottom button ─────────────────────────────────────── */
function ScrollButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position:       "absolute",
        bottom:         80,
        left:           "50%",
        transform:      "translateX(-50%)",
        padding:        "5px 12px",
        background:     "var(--bg-elevated)",
        border:         "1px solid var(--bg-border)",
        borderRadius:   "var(--radius-lg)",
        fontSize:       11,
        color:          "var(--text-secondary)",
        fontFamily:     "var(--font-mono)",
        cursor:         "pointer",
        boxShadow:      "0 2px 12px rgba(0,0,0,0.3)",
        whiteSpace:     "nowrap",
        zIndex:         10,
        transition:     "background 150ms",
      }}
    >
      ↓ scroll to latest
    </button>
  );
}

/* ── Main component ────────────────────────────────────────────────── */
export default function ChatInterface({ onUploadClick }) {
  const { messages, isQuerying, sendQuery } = useChat();

  const bottomRef    = useRef(null);
  const containerRef = useRef(null);
  const atBottomRef  = useRef(true);

  /* Track whether user has scrolled up */
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  /* Auto-scroll when new content arrives IF already at bottom */
  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  /* Always scroll on first message */
  useEffect(() => {
    if (messages.length === 1) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
      atBottomRef.current = true;
    }
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    atBottomRef.current = true;
  }, []);

  const isEmpty = messages.length === 0;

  return (
    <div style={{
      display:        "flex",
      flexDirection:  "column",
      height:         "100%",
      overflow:       "hidden",
      position:       "relative",
    }}>
      {/* Message list / empty state */}
      {isEmpty ? (
        <EmptyState onPromptClick={sendQuery} onUploadClick={onUploadClick} />
      ) : (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex:       1,
            overflowY:  "auto",
            padding:    "20px 24px",
            display:    "flex",
            flexDirection: "column",
            gap:        4,
          }}
        >
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={bottomRef} style={{ height: 1 }} />
        </div>
      )}

      {/* Query input */}
      <QueryInput />
    </div>
  );
}
