/**
 * components/shared/SourceCitations.jsx
 * ----------------------------------------
 * Right-side citations panel.
 * Shows the full retrieved chunks for the selected assistant message.
 *
 * Opened by:
 *   • Clicking the BookOpen icon in TopBar
 *   • Clicking a source card inside a MessageBubble
 *   • Clicking a [SOURCE N] citation tag (future)
 */

import { X, FileText, ExternalLink, Hash } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { formatLatency } from "@/utils/formatters";

/* ── Score pill ───────────────────────────────────────────────────── */
function ScorePill({ score }) {
  const pct   = Math.round(score * 100);
  const color = pct >= 90 ? "var(--text-success)"
              : pct >= 70 ? "var(--accent)"
              : "var(--text-warning)";
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      padding:      "1px 6px",
      background:   "var(--bg-base)",
      border:       `1px solid ${color}`,
      borderRadius: "var(--radius-sm)",
      fontSize:     10,
      fontFamily:   "var(--font-mono)",
      color,
      flexShrink:   0,
    }}>
      {pct}%
    </span>
  );
}

/* ── Single citation card ─────────────────────────────────────────── */
function CitationCard({ source, index }) {
  return (
    <div style={{
      padding:      "12px 14px",
      background:   "var(--bg-elevated)",
      border:       "1px solid var(--bg-border)",
      borderRadius: "var(--radius-md)",
      marginBottom: 8,
    }}>
      {/* Header */}
      <div style={{
        display:        "flex",
        alignItems:     "flex-start",
        justifyContent: "space-between",
        gap:            8,
        marginBottom:   8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {/* Source index badge */}
          <span style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            width:          20,
            height:         20,
            background:     "var(--accent-muted)",
            border:         "1px solid rgba(200,241,53,0.25)",
            borderRadius:   "var(--radius-sm)",
            fontSize:       10,
            fontFamily:     "var(--font-mono)",
            color:          "var(--accent)",
            flexShrink:     0,
            fontWeight:     500,
          }}>
            {source.index}
          </span>
          <span style={{
            fontSize:      11,
            fontFamily:    "var(--font-mono)",
            color:         "var(--text-primary)",
            overflow:      "hidden",
            whiteSpace:    "nowrap",
            textOverflow:  "ellipsis",
            fontWeight:    500,
          }}>
            {source.source}
          </span>
        </div>
        <ScorePill score={source.score} />
      </div>

      {/* Preview text */}
      <p style={{
        fontSize:   12,
        fontFamily: "var(--font-mono)",
        color:      "var(--text-secondary)",
        lineHeight: 1.65,
        margin:     0,
        whiteSpace: "pre-wrap",
        wordBreak:  "break-word",
      }}>
        {source.text_preview}
      </p>

      {/* Footer */}
      <div style={{
        display:     "flex",
        alignItems:  "center",
        gap:         8,
        marginTop:   8,
        paddingTop:  8,
        borderTop:   "1px solid var(--bg-border)",
      }}>
        <Hash size={11} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
        <span style={{
          fontSize:      10,
          fontFamily:    "var(--font-mono)",
          color:         "var(--text-tertiary)",
          overflow:      "hidden",
          whiteSpace:    "nowrap",
          textOverflow:  "ellipsis",
          flex:          1,
        }}>
          {source.vector_id}
        </span>
      </div>
    </div>
  );
}

/* ── Panel header ─────────────────────────────────────────────────── */
function PanelHeader({ count, onClose }) {
  return (
    <div style={{
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      padding:        "0 var(--space-4)",
      height:         "var(--topbar-h)",
      borderBottom:   "1px solid var(--bg-border)",
      flexShrink:     0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <FileText size={14} style={{ color: "var(--text-tertiary)" }} />
        <span style={{
          fontSize:    12,
          fontFamily:  "var(--font-mono)",
          fontWeight:  500,
          color:       "var(--text-primary)",
        }}>
          Sources
        </span>
        {count > 0 && (
          <span style={{
            display:        "inline-flex",
            alignItems:     "center",
            justifyContent: "center",
            minWidth:       18,
            height:         18,
            padding:        "0 5px",
            background:     "var(--accent-muted)",
            borderRadius:   "var(--radius-sm)",
            fontSize:       10,
            fontFamily:     "var(--font-mono)",
            color:          "var(--text-accent)",
          }}>
            {count}
          </span>
        )}
      </div>
      <button
        className="icon-btn"
        onClick={onClose}
        style={{ width: 26, height: 26 }}
        aria-label="Close citations panel"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */
export default function SourceCitations() {
  const citationPanelOpen = useAppStore((s) => s.citationPanelOpen);
  const activeCitations   = useAppStore((s) => s.activeCitations);
  const hideCitations     = useAppStore((s) => s.hideCitations);

  return (
    <aside
      className={`citations-panel ${citationPanelOpen ? "" : "collapsed"}`}
      aria-label="Source citations"
    >
      <PanelHeader
        count={activeCitations.length}
        onClose={hideCitations}
      />

      {/* Body */}
      <div style={{
        flex:       1,
        overflowY:  "auto",
        padding:    "var(--space-3) var(--space-4)",
      }}>
        {activeCitations.length === 0 ? (
          <div style={{
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "center",
            justifyContent: "center",
            height:         "100%",
            gap:            10,
            color:          "var(--text-tertiary)",
            textAlign:      "center",
            padding:        "var(--space-8)",
          }}>
            <FileText size={22} style={{ opacity: 0.35 }} />
            <p style={{
              fontSize:   11,
              fontFamily: "var(--font-mono)",
              lineHeight: 1.7,
              margin:     0,
            }}>
              Click a source card in any response to see the full retrieved chunks here.
            </p>
          </div>
        ) : (
          <>
            <p style={{
              fontSize:     10,
              fontFamily:   "var(--font-mono)",
              color:        "var(--text-tertiary)",
              marginBottom: "var(--space-3)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              {activeCitations.length} chunk{activeCitations.length !== 1 ? "s" : ""} · reranked
            </p>
            {activeCitations.map((src, i) => (
              <CitationCard key={src.vector_id} source={src} index={i} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
