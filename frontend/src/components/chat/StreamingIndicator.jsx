/**
 * components/chat/StreamingIndicator.jsx
 * ----------------------------------------
 * Animated "thinking" indicator shown while the LLM is generating.
 * Three variants:
 *   "thinking"  — before first token arrives (pulsing dots)
 *   "streaming" — tokens are arriving (blinking cursor)
 *   "reranking" — shown during the retrieval phase (scanning bar)
 */

export default function StreamingIndicator({ variant = "thinking" }) {
  if (variant === "streaming") {
    return (
      <span
        aria-label="Streaming response"
        style={{
          display:     "inline-block",
          width:       2,
          height:      14,
          background:  "var(--accent)",
          marginLeft:  2,
          verticalAlign: "text-bottom",
          animation:   "cursor-blink 700ms step-end infinite",
        }}
      />
    );
  }

  if (variant === "reranking") {
    return (
      <div
        aria-label="Retrieving context"
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          8,
          padding:      "10px 14px",
          background:   "var(--bg-surface)",
          border:       "1px solid var(--bg-border)",
          borderRadius: "var(--radius-lg)",
          maxWidth:     240,
        }}
      >
        {/* Scanning bar */}
        <div style={{
          width:        80,
          height:       3,
          background:   "var(--bg-border)",
          borderRadius: 2,
          overflow:     "hidden",
          flexShrink:   0,
        }}>
          <div style={{
            height:     "100%",
            width:      "40%",
            background: "var(--accent)",
            borderRadius: 2,
            animation:  "scan 1.2s ease-in-out infinite",
          }} />
        </div>
        <span style={{
          fontSize:   11,
          color:      "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
        }}>
          retrieving context…
        </span>
      </div>
    );
  }

  /* Default: thinking — three pulsing dots */
  return (
    <div
      aria-label="Thinking"
      style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 0" }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display:      "block",
            width:        6,
            height:       6,
            borderRadius: "50%",
            background:   "var(--text-tertiary)",
            animation:    `dot-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}

      {/* Keyframes injected once */}
      <style>{`
        @keyframes dot-pulse {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%            { transform: scale(1.0); opacity: 1;   }
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
        @keyframes scan {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%);  }
        }
      `}</style>
    </div>
  );
}
