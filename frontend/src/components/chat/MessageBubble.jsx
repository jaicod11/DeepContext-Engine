/**
 * components/chat/MessageBubble.jsx
 * -----------------------------------
 * Renders a single chat message — user or assistant.
 *
 * Assistant messages:
 *   • Markdown rendered via react-markdown + remark-gfm
 *   • [SOURCE N] tags converted to clickable lime-green pills
 *   • Sources footer with score bars and preview text
 *   • Streaming cursor injected while isStreaming = true
 *   • Latency + model meta shown after completion
 *
 * User messages:
 *   • Plain text, right-aligned
 */

import { useCallback } from "react";
import ReactMarkdown   from "react-markdown";
import remarkGfm       from "remark-gfm";
import rehypeRaw       from "rehype-raw";
import { Bot, User, AlertCircle, ChevronDown, ChevronUp, Clock, Cpu } from "lucide-react";
import { useState }    from "react";
import { useAppStore } from "@/stores/appStore";
import StreamingIndicator from "./StreamingIndicator";
import { injectCitationMarkup, filterReferencedSources } from "@/utils/parseSources";
import { formatLatency, truncate } from "@/utils/formatters";

/* ── Source score bar ─────────────────────────────────────────────── */
function ScoreBar({ score }) {
  const pct = Math.round(score * 100);
  const color = pct >= 90 ? "var(--text-success)"
              : pct >= 70 ? "var(--accent)"
              : "var(--text-warning)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        flex:         1,
        height:       3,
        background:   "var(--bg-border)",
        borderRadius: 2,
        overflow:     "hidden",
      }}>
        <div style={{
          height:     "100%",
          width:      `${pct}%`,
          background: color,
          borderRadius: 2,
        }} />
      </div>
      <span style={{ fontSize: 10, color, fontFamily: "var(--font-mono)", minWidth: 30, textAlign: "right" }}>
        {pct}%
      </span>
    </div>
  );
}

/* ── Inline source footer ─────────────────────────────────────────── */
function SourcesFooter({ sources, answer, onCitationClick }) {
  const [expanded, setExpanded] = useState(false);
  const referenced = filterReferencedSources(answer, sources);

  if (!sources?.length) return null;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--bg-border)", paddingTop: 10 }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display:     "flex",
          alignItems:  "center",
          gap:         5,
          color:       "var(--text-tertiary)",
          fontSize:    11,
          fontFamily:  "var(--font-mono)",
          marginBottom: expanded ? 8 : 0,
          transition:  "color 150ms",
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-tertiary)"}
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {sources.length} source{sources.length !== 1 ? "s" : ""} retrieved
        {referenced.length < sources.length && (
          <span style={{ color: "var(--text-tertiary)" }}>
            · {referenced.length} cited
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sources.map((src) => (
            <button
              key={src.vector_id}
              onClick={() => onCitationClick(src)}
              style={{
                display:      "flex",
                flexDirection:"column",
                gap:          4,
                padding:      "8px 10px",
                background:   "var(--bg-elevated)",
                border:       "1px solid var(--bg-border)",
                borderRadius: "var(--radius-md)",
                textAlign:    "left",
                cursor:       "pointer",
                transition:   "border-color 150ms, background 150ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent-dim)";
                e.currentTarget.style.background  = "var(--accent-muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--bg-border)";
                e.currentTarget.style.background  = "var(--bg-elevated)";
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{
                  fontSize:   11,
                  fontFamily: "var(--font-mono)",
                  color:      "var(--text-accent)",
                  fontWeight: 500,
                }}>
                  [{src.index}] {src.source}
                </span>
              </div>
              <ScoreBar score={src.score} />
              <p style={{
                fontSize:   11,
                color:      "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
                lineHeight: 1.5,
                margin:     0,
              }}>
                {truncate(src.text_preview, 140)}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Markdown renderer config ─────────────────────────────────────── */
const markdownComponents = {
  /* Override <p> to inject citation markup */
  p: ({ children, ...props }) => (
    <p
      {...props}
      style={{ margin: "0 0 10px", lineHeight: 1.7, lastChild: { marginBottom: 0 } }}
      dangerouslySetInnerHTML={
        typeof children === "string"
          ? { __html: injectCitationMarkup(children) }
          : undefined
      }
    >
      {typeof children === "string" ? undefined : children}
    </p>
  ),
  code: ({ inline, children, ...props }) =>
    inline ? (
      <code
        {...props}
        style={{
          background:   "var(--bg-elevated)",
          border:       "1px solid var(--bg-border)",
          borderRadius: 3,
          padding:      "1px 5px",
          fontSize:     "0.9em",
          fontFamily:   "var(--font-mono)",
          color:        "var(--accent)",
        }}
      >
        {children}
      </code>
    ) : (
      <pre style={{
        background:   "var(--bg-surface)",
        border:       "1px solid var(--bg-border)",
        borderRadius: "var(--radius-md)",
        padding:      "12px 14px",
        overflow:     "auto",
        margin:       "8px 0",
      }}>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} {...props}>
          {children}
        </code>
      </pre>
    ),
  ul: ({ children }) => (
    <ul style={{ paddingLeft: 18, margin: "6px 0", display: "flex", flexDirection: "column", gap: 3 }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol style={{ paddingLeft: 18, margin: "6px 0", display: "flex", flexDirection: "column", gap: 3 }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)" }}>
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>{children}</strong>
  ),
  h2: ({ children }) => (
    <h2 style={{
      fontFamily:  "var(--font-display)",
      fontStyle:   "italic",
      fontWeight:  300,
      fontSize:    17,
      color:       "var(--text-primary)",
      margin:      "14px 0 6px",
      borderBottom: "1px solid var(--bg-border)",
      paddingBottom: 4,
    }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{
      fontFamily: "var(--font-mono)",
      fontWeight: 500,
      fontSize:   13,
      color:      "var(--text-secondary)",
      margin:     "12px 0 4px",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}>
      {children}
    </h3>
  ),
};

/* ── Main component ────────────────────────────────────────────────── */
export default function MessageBubble({ message }) {
  const showCitations = useAppStore((s) => s.showCitations);
  const { role, content, sources, isStreaming, error, latency_ms, model } = message;

  const handleCitationClick = useCallback((source) => {
    showCitations(sources);
  }, [sources, showCitations]);

  /* ── User bubble ─────────────────────────────────────── */
  if (role === "user") {
    return (
      <div style={{
        display:        "flex",
        justifyContent: "flex-end",
        gap:            10,
        padding:        "4px 0",
      }}>
        <div style={{
          maxWidth:     "72%",
          padding:      "10px 14px",
          background:   "var(--bg-elevated)",
          border:       "1px solid var(--bg-border)",
          borderRadius: "var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)",
          fontSize:     13,
          lineHeight:   1.6,
          color:        "var(--text-primary)",
          fontFamily:   "var(--font-mono)",
          whiteSpace:   "pre-wrap",
          wordBreak:    "break-word",
        }}>
          {content}
        </div>
        <div style={{
          width:        28,
          height:       28,
          borderRadius: "50%",
          background:   "var(--bg-elevated)",
          border:       "1px solid var(--bg-border)",
          display:      "flex",
          alignItems:   "center",
          justifyContent: "center",
          flexShrink:   0,
          marginTop:    2,
        }}>
          <User size={13} style={{ color: "var(--text-secondary)" }} />
        </div>
      </div>
    );
  }

  /* ── Assistant bubble ────────────────────────────────── */
  return (
    <div style={{
      display: "flex",
      gap:     10,
      padding: "4px 0",
      alignItems: "flex-start",
    }}>
      {/* Avatar */}
      <div style={{
        width:        28,
        height:       28,
        borderRadius: "50%",
        background:   isStreaming ? "var(--accent-muted)" : "var(--bg-elevated)",
        border:       `1px solid ${isStreaming ? "var(--accent-dim)" : "var(--bg-border)"}`,
        display:      "flex",
        alignItems:   "center",
        justifyContent: "center",
        flexShrink:   0,
        marginTop:    2,
        transition:   "background 300ms, border-color 300ms",
      }}>
        <Bot size={13} style={{
          color: isStreaming ? "var(--accent)" : "var(--text-secondary)",
          transition: "color 300ms",
        }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Error state */}
        {error && (
          <div style={{
            display:      "flex",
            alignItems:   "flex-start",
            gap:          8,
            padding:      "10px 14px",
            background:   "rgba(255,107,107,0.06)",
            border:       "1px solid rgba(255,107,107,0.2)",
            borderRadius: "var(--radius-lg)",
            color:        "var(--text-error)",
            fontSize:     13,
            fontFamily:   "var(--font-mono)",
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Thinking state — no content yet */}
        {!error && isStreaming && !content && (
          <div style={{
            padding:      "10px 14px",
            background:   "var(--bg-surface)",
            border:       "1px solid var(--bg-border)",
            borderRadius: "var(--radius-lg)",
            display:      "inline-block",
          }}>
            <StreamingIndicator variant="reranking" />
          </div>
        )}

        {/* Answer content */}
        {!error && content && (
          <div style={{
            padding:      "12px 16px",
            background:   "var(--bg-surface)",
            border:       "1px solid var(--bg-border)",
            borderRadius: "var(--radius-lg)",
            fontSize:     13,
            lineHeight:   1.7,
            color:        "var(--text-primary)",
            fontFamily:   "var(--font-mono)",
          }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={markdownComponents}
            >
              {content}
            </ReactMarkdown>

            {/* Blinking cursor while streaming */}
            {isStreaming && <StreamingIndicator variant="streaming" />}

            {/* Sources */}
            {!isStreaming && sources?.length > 0 && (
              <SourcesFooter
                sources={sources}
                answer={content}
                onCitationClick={handleCitationClick}
              />
            )}
          </div>
        )}

        {/* Meta line — latency + model */}
        {!isStreaming && !error && content && (latency_ms || model) && (
          <div style={{
            display:    "flex",
            alignItems: "center",
            gap:        12,
            marginTop:  6,
            paddingLeft: 2,
          }}>
            {latency_ms && (
              <span style={{
                display:    "flex",
                alignItems: "center",
                gap:        4,
                fontSize:   10,
                color:      "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}>
                <Clock size={10} />
                {formatLatency(latency_ms)}
              </span>
            )}
            {model && (
              <span style={{
                display:    "flex",
                alignItems: "center",
                gap:        4,
                fontSize:   10,
                color:      "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}>
                <Cpu size={10} />
                {model}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
