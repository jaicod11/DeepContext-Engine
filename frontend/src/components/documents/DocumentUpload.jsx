/**
 * components/documents/DocumentUpload.jsx
 * -----------------------------------------
 * Full-screen upload modal with three tabs:
 *   • Upload  — drag-and-drop zone + file picker
 *   • Text    — paste raw text directly
 *   • Library — DocumentList table of ingested docs
 *
 * Opened from Sidebar "Upload Document" button or TopBar shortcut.
 * Closes on backdrop click or Escape key.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone }     from "react-dropzone";
import { X, Upload, FileText, Library, CloudUpload, AlertTriangle, CheckCircle } from "lucide-react";
import { useDocuments }    from "@/hooks/useDocuments";
import { useAppStore }     from "@/stores/appStore";
import { ingestText }      from "@/services/api";
import IngestionProgress   from "./IngestionProgress";
import DocumentList        from "./DocumentList";
import { formatBytes }     from "@/utils/formatters";

/* ── Accepted MIME types ─────────────────────────────────────────── */
const ACCEPT = {
  "application/pdf":                              [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain":                                   [".txt"],
  "text/markdown":                                [".md"],
  "text/html":                                    [".html", ".htm"],
};
const MAX_SIZE  = 50 * 1024 * 1024;  // 50 MB
const MAX_FILES = 10;

/* ── Tab bar ─────────────────────────────────────────────────────── */
function Tabs({ active, onChange, counts }) {
  const tabs = [
    { key: "upload",  label: "Upload",  icon: <CloudUpload size={13} /> },
    { key: "text",    label: "Paste Text", icon: <FileText size={13} /> },
    { key: "library", label: "Library", icon: <Library size={13} />, badge: counts.docs },
  ];
  return (
    <div style={{
      display:      "flex",
      gap:          2,
      padding:      "0 20px",
      borderBottom: "1px solid var(--bg-border)",
      flexShrink:   0,
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            display:        "flex",
            alignItems:     "center",
            gap:            6,
            padding:        "10px 14px",
            background:     "transparent",
            border:         "none",
            borderBottom:   `2px solid ${active === tab.key ? "var(--accent)" : "transparent"}`,
            color:          active === tab.key ? "var(--text-primary)" : "var(--text-tertiary)",
            fontFamily:     "var(--font-mono)",
            fontSize:       12,
            cursor:         "pointer",
            transition:     "color 150ms, border-color 150ms",
            marginBottom:   -1,
            whiteSpace:     "nowrap",
          }}
        >
          {tab.icon}
          {tab.label}
          {tab.badge > 0 && (
            <span style={{
              display:        "inline-flex",
              alignItems:     "center",
              justifyContent: "center",
              minWidth:       17,
              height:         17,
              padding:        "0 4px",
              background:     active === tab.key ? "var(--accent-muted)" : "var(--bg-elevated)",
              borderRadius:   "var(--radius-sm)",
              fontSize:       10,
              color:          active === tab.key ? "var(--text-accent)" : "var(--text-tertiary)",
            }}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── Dropzone tab ────────────────────────────────────────────────── */
function UploadTab({ onFiles, queue }) {
  const { getRootProps, getInputProps, isDragActive, isDragReject, fileRejections } = useDropzone({
    accept:    ACCEPT,
    maxSize:   MAX_SIZE,
    maxFiles:  MAX_FILES,
    onDropAccepted: onFiles,
  });

  const borderColor = isDragReject  ? "var(--text-error)"
                    : isDragActive  ? "var(--accent)"
                    : "var(--bg-border)";
  const bgColor     = isDragReject  ? "rgba(255,107,107,0.05)"
                    : isDragActive  ? "var(--accent-muted)"
                    : "transparent";

  return (
    <div style={{ padding: "20px 20px 0" }}>
      {/* Drop zone */}
      <div
        {...getRootProps()}
        style={{
          padding:      "36px 24px",
          border:       `2px dashed ${borderColor}`,
          borderRadius: "var(--radius-lg)",
          background:   bgColor,
          textAlign:    "center",
          cursor:       "pointer",
          transition:   "border-color 200ms, background 200ms",
          outline:      "none",
        }}
      >
        <input {...getInputProps()} />

        <div style={{
          width:        44,
          height:       44,
          borderRadius: "var(--radius-md)",
          background:   isDragActive ? "var(--accent)" : "var(--bg-elevated)",
          border:       `1px solid ${isDragActive ? "var(--accent)" : "var(--bg-border)"}`,
          display:      "flex",
          alignItems:   "center",
          justifyContent: "center",
          margin:       "0 auto 14px",
          transition:   "background 200ms, border-color 200ms",
        }}>
          <Upload size={18} style={{ color: isDragActive ? "#09090B" : "var(--text-tertiary)" }} />
        </div>

        {isDragActive ? (
          <p style={{ fontSize: 13, color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}>
            Drop to ingest
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--text-primary)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
              Drag files here or{" "}
              <span style={{ color: "var(--text-accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                browse
              </span>
            </p>
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
              PDF · DOCX · TXT · MD · HTML · up to {formatBytes(MAX_SIZE)} · {MAX_FILES} files max
            </p>
          </>
        )}
      </div>

      {/* Rejection errors */}
      {fileRejections.length > 0 && (
        <div style={{
          display:      "flex",
          alignItems:   "flex-start",
          gap:          8,
          marginTop:    10,
          padding:      "8px 12px",
          background:   "rgba(255,107,107,0.06)",
          border:       "1px solid rgba(255,107,107,0.2)",
          borderRadius: "var(--radius-md)",
        }}>
          <AlertTriangle size={13} style={{ color: "var(--text-error)", flexShrink: 0, marginTop: 1 }} />
          <div>
            {fileRejections.map(({ file, errors }) => (
              <div key={file.name} style={{ fontSize: 11, color: "var(--text-error)", fontFamily: "var(--font-mono)" }}>
                {file.name} — {errors.map((e) => e.message).join(", ")}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress list */}
      {queue.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <IngestionProgress queue={queue} />
        </div>
      )}
    </div>
  );
}

/* ── Text ingestion tab ──────────────────────────────────────────── */
function TextTab() {
  const [text,   setText]   = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState(null);   // null | "loading" | "success" | "error"
  const [error,  setError]  = useState("");
  const settings = useAppStore((s) => s.settings);
  const _addToast = useAppStore((s) => s._addToast);
  const addDocument = useAppStore((s) => s.addDocument);

  const handleIngest = async () => {
    if (text.trim().length < 10) return;
    setStatus("loading");
    setError("");
    try {
      const result = await ingestText({
        text,
        source:    source.trim() || "pasted-text",
        namespace: settings.namespace || null,
      });
      addDocument({ ...result, uploadedAt: Date.now() });
      _addToast({ message: `"${result.filename}" ingested — ${result.chunks_total} chunks`, type: "success" });
      setStatus("success");
      setText("");
      setSource("");
    } catch (err) {
      setError(err?.message ?? "Ingestion failed");
      setStatus("error");
      _addToast({ message: err?.message ?? "Ingestion failed", type: "error" });
    }
  };

  const charsLeft = 500_000 - text.length;

  return (
    <div style={{ padding: "20px" }}>
      <div style={{ marginBottom: 12 }}>
        <label style={{
          display:    "block",
          fontSize:   10,
          color:      "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 5,
        }}>
          Source label (for citations)
        </label>
        <input
          className="input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="e.g. quarterly-report-2024"
          style={{ fontSize: 12 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{
          display:    "block",
          fontSize:   10,
          color:      "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 5,
        }}>
          Document text
        </label>
        <textarea
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your document text here…"
          rows={10}
          style={{ resize: "vertical", minHeight: 180, fontSize: 12, lineHeight: 1.6 }}
        />
        <div style={{
          display:        "flex",
          justifyContent: "space-between",
          marginTop:      4,
          fontSize:       10,
          fontFamily:     "var(--font-mono)",
          color:          charsLeft < 10_000 ? "var(--text-warning)" : "var(--text-tertiary)",
        }}>
          <span>{text.length.toLocaleString()} chars</span>
          <span>{charsLeft.toLocaleString()} remaining</span>
        </div>
      </div>

      {status === "error" && (
        <div style={{
          display:       "flex",
          gap:           8,
          padding:       "8px 12px",
          background:    "rgba(255,107,107,0.06)",
          border:        "1px solid rgba(255,107,107,0.2)",
          borderRadius:  "var(--radius-md)",
          marginBottom:  12,
          fontSize:      11,
          fontFamily:    "var(--font-mono)",
          color:         "var(--text-error)",
        }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          {error}
        </div>
      )}

      {status === "success" && (
        <div style={{
          display:       "flex",
          gap:           8,
          padding:       "8px 12px",
          background:    "rgba(92,219,149,0.06)",
          border:        "1px solid rgba(92,219,149,0.2)",
          borderRadius:  "var(--radius-md)",
          marginBottom:  12,
          fontSize:      11,
          fontFamily:    "var(--font-mono)",
          color:         "var(--text-success)",
        }}>
          <CheckCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          Text ingested successfully. Paste another document or switch to the Library tab.
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleIngest}
        disabled={text.trim().length < 10 || status === "loading"}
        style={{
          width:          "100%",
          justifyContent: "center",
          opacity:        text.trim().length < 10 ? 0.5 : 1,
          cursor:         text.trim().length < 10 ? "not-allowed" : "pointer",
        }}
      >
        {status === "loading" ? "Ingesting…" : "Ingest Text"}
      </button>
    </div>
  );
}

/* ── Modal shell ─────────────────────────────────────────────────── */
export default function DocumentUpload({ onClose }) {
  const [activeTab, setActiveTab]   = useState("upload");
  const { uploadFiles, uploadQueue, documents } = useDocuments();
  const backdropRef = useRef(null);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Close on backdrop click */
  const handleBackdrop = (e) => {
    if (e.target === backdropRef.current) onClose();
  };

  const handleFiles = useCallback(
    (acceptedFiles) => uploadFiles(acceptedFiles),
    [uploadFiles]
  );

  const activeQueue = uploadQueue.filter(
    (e) => e.status === "uploading" || e.status === "error" || e.status === "complete"
  );

  return (
    /* Backdrop */
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      style={{
        position:        "fixed",
        inset:           0,
        background:      "rgba(0,0,0,0.7)",
        backdropFilter:  "blur(4px)",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        zIndex:          200,
        padding:         24,
        animation:       "fade-in 150ms ease",
      }}
    >
      <style>{`
        @keyframes fade-in   { from { opacity: 0; }                         to { opacity: 1; } }
        @keyframes slide-up  { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Document upload"
        style={{
          width:          "100%",
          maxWidth:       580,
          maxHeight:      "85vh",
          background:     "var(--bg-surface)",
          border:         "1px solid var(--bg-border)",
          borderRadius:   "var(--radius-lg)",
          display:        "flex",
          flexDirection:  "column",
          overflow:       "hidden",
          animation:      "slide-up 200ms cubic-bezier(0.4,0,0.2,1)",
          boxShadow:      "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "14px 20px",
          borderBottom:   "1px solid var(--bg-border)",
          flexShrink:     0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CloudUpload size={15} style={{ color: "var(--text-tertiary)" }} />
            <span style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
              fontSize:   13,
              color:      "var(--text-primary)",
            }}>
              Document Manager
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            style={{ width: 28, height: 28 }}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <Tabs
          active={activeTab}
          onChange={setActiveTab}
          counts={{ docs: documents.length }}
        />

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {activeTab === "upload" && (
            <UploadTab onFiles={handleFiles} queue={activeQueue} />
          )}
          {activeTab === "text" && <TextTab />}
          {activeTab === "library" && (
            <div style={{ padding: "12px 16px", height: "100%" }}>
              <DocumentList />
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "10px 20px",
          borderTop:      "1px solid var(--bg-border)",
          flexShrink:     0,
        }}>
          <span style={{
            fontSize:   10,
            fontFamily: "var(--font-mono)",
            color:      "var(--text-tertiary)",
          }}>
            {documents.length} doc{documents.length !== 1 ? "s" : ""} in library
            {activeQueue.some((e) => e.status === "uploading") && (
              <span style={{ color: "var(--accent)", marginLeft: 8 }}>· uploading…</span>
            )}
          </span>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 11 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
