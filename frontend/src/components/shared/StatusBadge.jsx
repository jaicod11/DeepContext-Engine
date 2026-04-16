/**
 * components/shared/StatusBadge.jsx
 * ------------------------------------
 * Reusable status pill: ok | degraded | error | loading | unknown
 */

export default function StatusBadge({ status, label }) {
  const map = {
    ok:       { dot: "status-dot--ok",      text: "var(--text-success)",   bg: "rgba(92,219,149,0.08)"  },
    degraded: { dot: "status-dot--loading", text: "var(--text-warning)",   bg: "rgba(255,179,71,0.08)"  },
    error:    { dot: "status-dot--error",   text: "var(--text-error)",     bg: "rgba(255,107,107,0.08)" },
    loading:  { dot: "status-dot--loading", text: "var(--text-secondary)", bg: "var(--bg-elevated)"     },
    unknown:  { dot: "status-dot--unknown", text: "var(--text-tertiary)",  bg: "var(--bg-elevated)"     },
  };
  const style = map[status] ?? map.unknown;

  return (
    <span style={{
      display:       "inline-flex",
      alignItems:    "center",
      gap:           5,
      padding:       "2px 8px",
      background:    style.bg,
      borderRadius:  "var(--radius-sm)",
      fontSize:      11,
      fontFamily:    "var(--font-mono)",
      color:         style.text,
      whiteSpace:    "nowrap",
    }}>
      <span className={`status-dot ${style.dot}`} />
      {label ?? status}
    </span>
  );
}
