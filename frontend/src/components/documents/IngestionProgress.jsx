/**
 * components/documents/IngestionProgress.jsx
 * --------------------------------------------
 * Displays the live upload + ingestion progress for each queued file.
 *
 * Variants:
 *   uploading  — progress bar filling with percentage
 *   complete   — green check + chunk count
 *   error      — red indicator + error message
 *   pending    — muted waiting state
 */

import { CheckCircle, XCircle, Loader, Clock } from "lucide-react";
import { formatBytes } from "@/utils/formatters";

/* ── Status icon ──────────────────────────────────────────────────── */
function StatusIcon({ status }) {
  const size = 14;
  if (status === "complete")  return <CheckCircle size={size} style={{ color: "var(--text-success)", flexShrink: 0 }} />;
  if (status === "error")     return <XCircle     size={size} style={{ color: "var(--text-error)",   flexShrink: 0 }} />;
  if (status === "uploading") return (
    <span style={{
      display:     "inline-block",
      width:       size,
      height:      size,
      border:      "2px solid var(--bg-border)",
      borderTop:   "2px solid var(--accent)",
      borderRadius:"50%",
      animation:   "spin 700ms linear infinite",
      flexShrink:  0,
    }} />
  );
  return <Clock size={size} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />;
}

/* ── Single file row ──────────────────────────────────────────────── */
function ProgressRow({ entry }) {
  const { file, status, progress, error } = entry;
  const isActive = status === "uploading";

  return (
    <div style={{
      padding:      "10px 0",
      borderBottom: "1px solid var(--bg-border)",
    }}>
      {/* Top row — icon + name + size */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: isActive ? 8 : 0 }}>
        <StatusIcon status={status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize:      12,
            fontFamily:    "var(--font-mono)",
            color:         status === "error" ? "var(--text-error)" : "var(--text-primary)",
            overflow:      "hidden",
            whiteSpace:    "nowrap",
            textOverflow:  "ellipsis",
          }}>
            {file.name}
          </div>
          {error && (
            <div style={{ fontSize: 11, color: "var(--text-error)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              {error}
            </div>
          )}
          {status === "complete" && (
            <div style={{ fontSize: 10, color: "var(--text-success)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              ingested successfully
            </div>
          )}
        </div>
        <span style={{
          fontSize:   10,
          fontFamily: "var(--font-mono)",
          color:      "var(--text-tertiary)",
          flexShrink: 0,
        }}>
          {formatBytes(file.size)}
        </span>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div style={{ paddingLeft: 22 }}>
          <div style={{
            height:       3,
            background:   "var(--bg-border)",
            borderRadius: 2,
            overflow:     "hidden",
          }}>
            <div style={{
              height:     "100%",
              width:      `${progress}%`,
              background: "var(--accent)",
              borderRadius: 2,
              transition: "width 200ms ease",
            }} />
          </div>
          <div style={{
            display:        "flex",
            justifyContent: "space-between",
            marginTop:      4,
            fontSize:       10,
            fontFamily:     "var(--font-mono)",
            color:          "var(--text-tertiary)",
          }}>
            <span>Uploading…</span>
            <span>{progress}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Summary bar ──────────────────────────────────────────────────── */
function SummaryBar({ queue }) {
  const total    = queue.length;
  const done     = queue.filter((e) => e.status === "complete").length;
  const failed   = queue.filter((e) => e.status === "error").length;
  const active   = queue.filter((e) => e.status === "uploading").length;

  if (total === 0) return null;

  return (
    <div style={{
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      padding:        "8px 0 4px",
      fontSize:       11,
      fontFamily:     "var(--font-mono)",
      color:          "var(--text-tertiary)",
    }}>
      <span>
        {active > 0 && <span style={{ color: "var(--accent)" }}>{active} uploading · </span>}
        {done > 0   && <span style={{ color: "var(--text-success)" }}>{done} complete · </span>}
        {failed > 0 && <span style={{ color: "var(--text-error)" }}>{failed} failed · </span>}
        {total} total
      </span>
      {active === 0 && done > 0 && (
        <span style={{ color: "var(--text-success)" }}>✓ All done</span>
      )}
    </div>
  );
}

/* ── Main export ──────────────────────────────────────────────────── */
export default function IngestionProgress({ queue }) {
  if (!queue?.length) return null;

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <SummaryBar queue={queue} />
      {queue.map((entry) => (
        <ProgressRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
