/**
 * components/documents/DocumentList.jsx
 * ----------------------------------------
 * Full-page document management table.
 * Shows all ingested documents with metadata and delete actions.
 *
 * Used inside the DocumentUpload modal on the "Library" tab.
 */

import { useState } from "react";
import {
  FileText, Trash2, RefreshCw, Database,
  ChevronUp, ChevronDown, AlertTriangle,
} from "lucide-react";
import { useDocuments }  from "@/hooks/useDocuments";
import { useAppStore }   from "@/stores/appStore";
import { formatBytes, formatRelativeTime } from "@/utils/formatters";

/* ── File-type badge ──────────────────────────────────────────────── */
function TypeBadge({ filename }) {
  const ext = filename?.split(".").pop()?.toUpperCase() ?? "?";
  const colors = {
    PDF:  { bg: "rgba(255,107,107,0.1)", color: "#FF6B6B" },
    DOCX: { bg: "rgba(123,167,247,0.1)", color: "#7BA7F7" },
    DOC:  { bg: "rgba(123,167,247,0.1)", color: "#7BA7F7" },
    TXT:  { bg: "var(--bg-elevated)",    color: "var(--text-tertiary)" },
    MD:   { bg: "var(--bg-elevated)",    color: "var(--text-tertiary)" },
    HTML: { bg: "rgba(200,241,53,0.08)", color: "var(--accent)" },
  };
  const { bg, color } = colors[ext] ?? colors.TXT;
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      padding:      "1px 6px",
      background:   bg,
      borderRadius: "var(--radius-sm)",
      fontSize:     10,
      fontFamily:   "var(--font-mono)",
      fontWeight:   500,
      color,
      flexShrink:   0,
      letterSpacing:"0.04em",
    }}>
      {ext}
    </span>
  );
}

/* ── Delete confirmation inline ───────────────────────────────────── */
function DeleteConfirm({ onConfirm, onCancel }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize:   11,
        color:      "var(--text-error)",
        fontFamily: "var(--font-mono)",
      }}>
        Delete?
      </span>
      <button
        onClick={onConfirm}
        style={{
          padding:      "2px 8px",
          background:   "rgba(255,107,107,0.12)",
          border:       "1px solid rgba(255,107,107,0.3)",
          borderRadius: "var(--radius-sm)",
          fontSize:     11,
          color:        "var(--text-error)",
          fontFamily:   "var(--font-mono)",
          cursor:       "pointer",
        }}
      >
        Yes
      </button>
      <button
        onClick={onCancel}
        style={{
          padding:      "2px 8px",
          background:   "var(--bg-elevated)",
          border:       "1px solid var(--bg-border)",
          borderRadius: "var(--radius-sm)",
          fontSize:     11,
          color:        "var(--text-secondary)",
          fontFamily:   "var(--font-mono)",
          cursor:       "pointer",
        }}
      >
        No
      </button>
    </div>
  );
}

/* ── Table row ────────────────────────────────────────────────────── */
function DocRow({ doc, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(doc.document_id, doc.namespace);
    setDeleting(false);
    setConfirming(false);
  };

  return (
    <tr style={{
      borderBottom: "1px solid var(--bg-border)",
      opacity:      deleting ? 0.4 : 1,
      transition:   "opacity 200ms",
    }}>
      {/* File info */}
      <td style={{ padding: "10px 12px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          <span style={{
            fontSize:      12,
            fontFamily:    "var(--font-mono)",
            color:         "var(--text-primary)",
            overflow:      "hidden",
            whiteSpace:    "nowrap",
            textOverflow:  "ellipsis",
            maxWidth:      220,
          }} title={doc.filename}>
            {doc.filename}
          </span>
          <TypeBadge filename={doc.filename} />
        </div>
      </td>

      {/* Chunks */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          {doc.chunks_total?.toLocaleString()}
        </span>
      </td>

      {/* Namespace */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
        <span style={{
          fontSize:   11,
          fontFamily: "var(--font-mono)",
          color:      "var(--text-accent)",
          background: "var(--accent-muted)",
          padding:    "1px 6px",
          borderRadius: "var(--radius-sm)",
        }}>
          {doc.namespace || "default"}
        </span>
      </td>

      {/* Uploaded */}
      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          {formatRelativeTime(doc.uploadedAt ?? Date.now())}
        </span>
      </td>

      {/* Actions */}
      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        {confirming ? (
          <DeleteConfirm
            onConfirm={handleDelete}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <button
            className="icon-btn"
            onClick={() => setConfirming(true)}
            disabled={deleting}
            title="Delete document"
            style={{ width: 28, height: 28, marginLeft: "auto" }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </td>
    </tr>
  );
}

/* ── Column header with sort ──────────────────────────────────────── */
function ColHeader({ label, sortKey, currentSort, onSort }) {
  const active = currentSort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        padding:       "8px 12px",
        textAlign:     "left",
        fontSize:      10,
        fontFamily:    "var(--font-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color:         active ? "var(--text-accent)" : "var(--text-tertiary)",
        cursor:        "pointer",
        userSelect:    "none",
        whiteSpace:    "nowrap",
        borderBottom:  "1px solid var(--bg-border)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        {active && (
          currentSort.dir === "asc"
            ? <ChevronUp size={10} />
            : <ChevronDown size={10} />
        )}
      </span>
    </th>
  );
}

/* ── Main component ────────────────────────────────────────────────── */
export default function DocumentList() {
  const { documents, deleteDoc, refreshStats } = useDocuments();
  const [sort, setSort] = useState({ key: "uploadedAt", dir: "desc" });

  const handleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  };

  const sorted = [...documents].sort((a, b) => {
    const av = a[sort.key] ?? 0;
    const bv = b[sort.key] ?? 0;
    const cmp = typeof av === "string"
      ? av.localeCompare(bv)
      : av - bv;
    return sort.dir === "asc" ? cmp : -cmp;
  });

  if (documents.length === 0) {
    return (
      <div style={{
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        padding:        "48px 24px",
        gap:            12,
        color:          "var(--text-tertiary)",
        textAlign:      "center",
      }}>
        <Database size={28} style={{ opacity: 0.3 }} />
        <p style={{ fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.7, margin: 0 }}>
          No documents ingested yet.<br />
          Switch to the Upload tab to add your first file.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        padding:        "8px 4px 12px",
        flexShrink:     0,
      }}>
        <span style={{
          fontSize:   11,
          fontFamily: "var(--font-mono)",
          color:      "var(--text-tertiary)",
        }}>
          {documents.length} document{documents.length !== 1 ? "s" : ""}
        </span>
        <button
          className="icon-btn"
          onClick={refreshStats}
          title="Refresh"
          style={{ width: 26, height: 26 }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 1 }}>
            <tr>
              <ColHeader label="File"      sortKey="filename"    currentSort={sort} onSort={handleSort} />
              <ColHeader label="Chunks"    sortKey="chunks_total" currentSort={sort} onSort={handleSort} />
              <ColHeader label="Namespace" sortKey="namespace"   currentSort={sort} onSort={handleSort} />
              <ColHeader label="Uploaded"  sortKey="uploadedAt"  currentSort={sort} onSort={handleSort} />
              <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--bg-border)" }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((doc) => (
              <DocRow key={doc.document_id} doc={doc} onDelete={deleteDoc} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
