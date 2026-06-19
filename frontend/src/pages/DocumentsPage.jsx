/**
 * DocumentsPage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Documents grid page (image 2). Lists all uploaded documents as cards.
 * Clicking a card navigates to /chat/:documentId which opens
 * DocumentChatPage with that document pre-selected.
 *
 * Uses the existing useDocuments() hook — no backend or store changes.
 */

import { useState, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
    FileText, Upload, UploadCloud, Search, SlidersHorizontal,
} from "lucide-react";
import { useDocuments } from "@/hooks/useDocuments";

const TABS = ["All", "Recent", "Most Chunks", "Unindexed"];

function formatDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
        return `Yesterday, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DocCard({ doc, onClick }) {
    return (
        <button className="doc-card" onClick={onClick}>
            <div className="doc-card__top">
                <div className="doc-card__icon">
                    <FileText size={16} strokeWidth={2} />
                </div>
                <span className="doc-card__qbadge">{doc.chunks_total ?? 0} chunks</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div className="doc-card__name">{doc.filename}</div>
                <div className="doc-card__meta">{doc.namespace || "default"} namespace</div>
            </div>
            <div className="doc-card__footer">
                <span className="doc-card__date">{formatDate(doc.uploadedAt)}</span>
                <div className="doc-card__dot" />
            </div>
        </button>
    );
}

export default function DocumentsPage() {
    const navigate = useNavigate();
    const { documents, uploadFiles } = useDocuments();

    const [activeTab, setActiveTab] = useState("All");
    const [search, setSearch] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef();

    const filtered = useMemo(() => {
        let list = [...documents];

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((d) => d.filename.toLowerCase().includes(q));
        }

        if (activeTab === "Recent") {
            list = list
                .filter((d) => d.uploadedAt)
                .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))
                .slice(0, 12);
        } else if (activeTab === "Most Chunks") {
            list = [...list].sort((a, b) => (b.chunks_total ?? 0) - (a.chunks_total ?? 0));
        } else if (activeTab === "Unindexed") {
            list = list.filter((d) => !d.chunks_total || d.chunks_total === 0);
        } else {
            list = list.sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
        }

        return list;
    }, [documents, search, activeTab]);

    const handleFiles = useCallback(async (files) => {
        const valid = [...files].filter((f) =>
            /\.(pdf|docx?|txt|md|html?)$/i.test(f.name)
        );
        if (valid.length) await uploadFiles(valid);
    }, [uploadFiles]);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
    };

    return (
        <div className="docs-page">

            {/* Top bar */}
            <div className="docs-page__topbar">
                <h1>Documents</h1>
                <button className="btn-primary" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={14} strokeWidth={2.5} />
                    Upload Document
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.html"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => handleFiles(e.target.files)}
                />
            </div>

            {/* Filter bar */}
            <div className="docs-page__filterbar">
                <div className="docs-page__tabs">
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            className={`docs-page__tab${activeTab === tab ? " active" : ""}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="docs-page__search">
                        <Search size={13} strokeWidth={2} color="var(--text-muted)" />
                        <input
                            placeholder="Search documents…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <button className="btn-ghost">
                        <SlidersHorizontal size={12} strokeWidth={2} />
                        Filter
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="docs-page__body">

                {/* Dropzone */}
                <div
                    className={`docs-dropzone${dragOver ? " dragover" : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                >
                    <div className="docs-dropzone__icon">
                        <UploadCloud size={18} strokeWidth={2} />
                    </div>
                    <p className="docs-dropzone__title">Drop a file here to analyze</p>
                    <p className="docs-dropzone__sub">PDF, DOCX, TXT, MD, HTML supported</p>
                </div>

                {/* Grid / Empty state */}
                {filtered.length === 0 ? (
                    <div className="empty-state" style={{ padding: "60px 20px" }}>
                        <FileText size={28} />
                        <span>
                            {documents.length === 0
                                ? "No documents uploaded yet"
                                : "No documents match your search"}
                        </span>
                    </div>
                ) : (
                    <div className="docs-grid">
                        {filtered.map((doc) => (
                            <DocCard
                                key={doc.document_id}
                                doc={doc}
                                onClick={() => navigate(`/chat/${doc.document_id}`)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}