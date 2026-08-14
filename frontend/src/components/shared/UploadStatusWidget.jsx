/**
 * UploadStatusWidget.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Google Drive-style upload status panel, fixed to the bottom-right corner.
 * Reads the REAL uploadQueue from appStore (already populated by
 * useDocuments().uploadFile / uploadFiles) — no new state needed.
 *
 * Rendered once, globally, in App.jsx — so it shows regardless of which
 * page triggered the upload (Documents page, or the modal in DocumentChatPage).
 */

import { useState, useEffect } from "react";
import {
    FileText, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";

function StatusIcon({ status }) {
    if (status === "complete") return <CheckCircle2 size={14} strokeWidth={2} color="var(--primary)" />;
    if (status === "error") return <XCircle size={14} strokeWidth={2} color="var(--danger)" />;
    return <Loader2 size={14} strokeWidth={2} className="spin" color="var(--text-muted)" />;
}

export default function UploadStatusWidget() {
    const uploadQueue = useAppStore((s) => s.uploadQueue);
    const clearCompleted = useAppStore((s) => s.clearCompletedUploads);

    const [collapsed, setCollapsed] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    const activeEntries = uploadQueue.filter(
        (e) => e.status === "uploading" || e.status === "pending"
    );
    const doneEntries = uploadQueue.filter((e) => e.status === "complete");
    const errorEntries = uploadQueue.filter((e) => e.status === "error");

    // Bring the widget back automatically whenever a new upload starts,
    // even if the user dismissed it after the last batch finished.
    useEffect(() => {
        if (activeEntries.length > 0) setDismissed(false);
    }, [activeEntries.length]);

    if (uploadQueue.length === 0 || dismissed) return null;

    const isUploading = activeEntries.length > 0;

    const headerLabel = isUploading
        ? `Uploading ${activeEntries.length} file${activeEntries.length !== 1 ? "s" : ""}…`
        : errorEntries.length > 0
            ? `${doneEntries.length} uploaded, ${errorEntries.length} failed`
            : `${doneEntries.length} file${doneEntries.length !== 1 ? "s" : ""} uploaded`;

    const handleDismiss = (e) => {
        e.stopPropagation();
        setDismissed(true);
        // Clean the store's completed entries too, so reopening later
        // (e.g. new upload) starts from a clean queue.
        clearCompleted?.();
    };

    return (
        <div className="upload-widget">
            <div className="upload-widget__header" onClick={() => setCollapsed((c) => !c)}>
                <div className="upload-widget__title-row">
                    {isUploading && <Loader2 size={13} strokeWidth={2} className="spin" color="var(--primary)" />}
                    <span className="upload-widget__title">{headerLabel}</span>
                </div>
                <div className="upload-widget__actions">
                    <button
                        className="upload-widget__icon-btn"
                        onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
                    >
                        {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <button className="upload-widget__icon-btn" onClick={handleDismiss}>
                        <X size={14} />
                    </button>
                </div>
            </div>

            {!collapsed && (
                <div className="upload-widget__list">
                    {uploadQueue.map((entry) => (
                        <div key={entry.id} className="upload-widget__item">
                            <div className="upload-widget__item-icon">
                                <FileText size={13} strokeWidth={2} />
                            </div>
                            <div className="upload-widget__item-info">
                                <div className="upload-widget__item-name">
                                    {entry.file?.name ?? "Untitled"}
                                </div>
                                {entry.status === "error" ? (
                                    <div className="upload-widget__item-error">
                                        {entry.error ?? "Upload failed"}
                                    </div>
                                ) : (
                                    <div className="upload-widget__progress-track">
                                        <div
                                            className="upload-widget__progress-fill"
                                            style={{
                                                width: `${entry.status === "complete" ? 100 : (entry.progress ?? 0)}%`,
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="upload-widget__item-status">
                                <StatusIcon status={entry.status} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}