/**
 * components/layout/Sidebar.jsx
 * --------------------------------
 * Left sidebar — document list, namespace selector, index stats,
 * and a shortcut to open the upload modal.
 */

import { useEffect, useState } from "react";
import {
  FileText,
  FileType,
  Upload,
  Trash2,
  Database,
  ChevronDown,
  RefreshCw,
  File,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDocuments } from "@/hooks/useDocuments";
import { formatBytes, formatRelativeTime } from "@/utils/formatters";

/* ── File type → icon ─────────────────────────────────────────────── */
function DocIcon({ filename }) {
  const ext = filename?.split(".").pop()?.toLowerCase();
  const props = { size: 14 };
  if (ext === "pdf") return <FileText {...props} style={{ color: "#FF6B6B" }} />;
  if (ext === "docx" || ext === "doc") return <FileType {...props} style={{ color: "#7BA7F7" }} />;
  if (ext === "txt" || ext === "md") return <File     {...props} style={{ color: "var(--text-tertiary)" }} />;
  return <File {...props} style={{ color: "var(--text-tertiary)" }} />;
}

/* ── Index stats bar ───────────────────────────────────────────────── */
function StatsBar({ stats }) {
  if (!stats) return null;
  const pct = Math.min(Math.round((stats.index_fullness ?? 0) * 100), 100);

  return (
    <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--bg-border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="mono-label">Index</span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {stats.total_vectors?.toLocaleString()} vectors
        </span>
      </div>
      {/* Fullness bar */}
      <div style={{
        height: 3,
        background: "var(--bg-border)",
        borderRadius: 2,
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "var(--accent)",
          borderRadius: 2,
          transition: "width 600ms ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {pct}% full
        </span>
        <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {Object.keys(stats.namespaces ?? {}).length} ns
        </span>
      </div>
    </div>
  );
}

/* ── Namespace selector ────────────────────────────────────────────── */
function NamespaceSelector() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings.namespace ?? "");

  const commit = () => {
    updateSettings({ namespace: draft.trim() || "" });
    setEditing(false);
  };

  return (
    <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--bg-border)" }}>
      <div className="mono-label" style={{ marginBottom: 6 }}>Namespace</div>
      {editing ? (
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          placeholder="default"
          autoFocus
          style={{ fontSize: 12 }}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "5px 8px",
            background: "var(--bg-input)",
            border: "1px solid var(--bg-border)",
            borderRadius: "var(--radius-md)",
            color: settings.namespace ? "var(--text-accent)" : "var(--text-tertiary)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span>{settings.namespace || "default"}</span>
          <ChevronDown size={12} />
        </button>
      )}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */
export default function Sidebar({ onUploadClick }) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const { documents, uploadQueue, indexStats, deleteDoc, refreshStats } = useDocuments();

  useEffect(() => { refreshStats(); }, []);

  const pendingUploads = uploadQueue.filter((u) => u.status === "uploading").length;

  return (
    <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`} aria-label="Document sidebar">

      {/* Header */}
      <div className="sidebar__header">
        <span className="sidebar__logo">
          rag<span>.</span>app
        </span>
        <button
          className="icon-btn"
          onClick={refreshStats}
          title="Refresh index stats"
          style={{ width: 24, height: 24 }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Index stats */}
      <StatsBar stats={indexStats} />

      {/* Namespace */}
      <NamespaceSelector />

      {/* Upload CTA */}
      <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--bg-border)" }}>
        <button
          className="btn btn-primary"
          onClick={onUploadClick}
          style={{ width: "100%", justifyContent: "center" }}
        >
          <Upload size={13} />
          {pendingUploads > 0 ? `Uploading ${pendingUploads}…` : "Upload Document"}
        </button>
      </div>

      {/* Document list */}
      <div className="sidebar__content">
        <div style={{ padding: "var(--space-2) var(--space-4) var(--space-1)" }}>
          <div className="mono-label">
            Documents
            {documents.length > 0 && (
              <span style={{ marginLeft: 6, color: "var(--text-tertiary)" }}>
                ({documents.length})
              </span>
            )}
          </div>
        </div>

        {/* Upload queue — in-progress */}
        {uploadQueue.filter((u) => u.status === "uploading").map((entry) => (
          <div key={entry.id} className="doc-item">
            <div className="doc-item__icon">
              <Upload size={12} style={{ color: "var(--accent)" }} />
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div className="doc-item__name">{entry.file.name}</div>
              {/* Progress bar */}
              <div style={{
                height: 2,
                background: "var(--bg-border)",
                borderRadius: 1,
                overflow: "hidden",
                marginTop: 4,
              }}>
                <div style={{
                  height: "100%",
                  width: `${entry.progress}%`,
                  background: "var(--accent)",
                  transition: "width 200ms ease",
                  borderRadius: 1,
                }} />
              </div>
            </div>
            <span className="doc-item__meta">{entry.progress}%</span>
          </div>
        ))}

        {/* Ingested documents */}
        {documents.length === 0 && uploadQueue.length === 0 && (
          <div style={{
            padding: "var(--space-6) var(--space-4)",
            textAlign: "center",
            color: "var(--text-tertiary)",
            fontSize: 12,
            lineHeight: 1.8,
          }}>
            <Database size={20} style={{ margin: "0 auto var(--space-3)", opacity: 0.4 }} />
            No documents ingested.<br />Upload a file to get started.
          </div>
        )}

        {documents.map((doc) => (
          <div key={doc.document_id} className="doc-item">
            <div className="doc-item__icon">
              <DocIcon filename={doc.filename} />
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div className="doc-item__name" title={doc.filename}>
                {doc.filename}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 1 }}>
                {doc.chunks_total} chunks · {formatRelativeTime(doc.uploadedAt ?? Date.now())}
              </div>
            </div>
            <button
              className="doc-item__delete icon-btn"
              onClick={() => deleteDoc(doc.document_id, doc.namespace)}
              title="Delete document"
              style={{ width: 24, height: 24 }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Footer — vector count summary */}
      <div className="sidebar__footer">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Database size={12} style={{ color: "var(--text-tertiary)" }} />
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {indexStats?.total_vectors?.toLocaleString() ?? "—"} vectors indexed
          </span>
        </div>
      </div>
    </aside>
  );
}
