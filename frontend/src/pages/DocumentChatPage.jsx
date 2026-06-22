/**
 * DocumentChatPage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Split-view page: document viewer (left) + RAG chat panel (right).
 * Matches the HomeDocumentActive design from deep.html.
 *
 * Flow:
 *  - No document selected → shows document picker / upload state
 *  - Document selected    → split view with doc content + chat
 *
 * All RAG queries go through the existing appStore.sendQuery — nothing
 * in the backend or store is changed.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    FileText, Zap, Sparkles, ZoomIn, Download,
    ArrowUp, BookOpen, User, Upload, ChevronLeft,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDocuments } from "@/hooks/useDocuments";

/* ── Helpers ────────────────────────────────────────────────────────────── */

const SUGGESTED_QUESTIONS = [
    "What are the key topics covered in this document?",
    "Summarize the main points",
    "What are the most important findings?",
    "What conclusions or recommendations are made?",
];

function formatUploadedAt(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
    });
}

/* ── DocViewer ──────────────────────────────────────────────────────────── */

function DocViewer({ doc, highlightedChunk }) {
    // Build "sections" from the doc's chunk previews when available,
    // otherwise show a placeholder skeleton based on chunk count
    const sections = doc._sections ?? [];
    const chunkCount = doc.chunks_total ?? 0;

    return (
        <div className="doc-viewer">
            {/* Top bar */}
            <div className="doc-viewer__topbar">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="doc-viewer__file-pill">
                        <FileText size={13} strokeWidth={2} color="var(--text-muted)" />
                        <span className="doc-viewer__file-name">{doc.filename}</span>
                    </div>
                    <span className="doc-viewer__page-count">{chunkCount} chunks</span>
                </div>
                <div className="doc-viewer__actions">
                    <button className="doc-viewer__action-btn">
                        <ZoomIn size={12} strokeWidth={2} />
                        100%
                    </button>
                    <button className="doc-viewer__action-btn">
                        <Download size={12} strokeWidth={2} />
                    </button>
                </div>
            </div>

            {/* AI insights banner */}
            <div className="doc-viewer__insights-bar">
                <Sparkles size={13} strokeWidth={2} color="var(--primary)" />
                <span className="doc-viewer__insights-text">
                    Document indexed — {chunkCount} chunks ready for analysis
                </span>
            </div>

            {/* Content */}
            <div className="doc-viewer__body">
                <h1 className="doc-viewer__title">
                    {doc.filename.replace(/\.[^.]+$/, "")}
                </h1>
                <p className="doc-viewer__meta">
                    Uploaded {formatUploadedAt(doc.uploadedAt)} · {chunkCount} chunks indexed
                </p>

                {/* Highlighted chunk from last cited source */}
                {highlightedChunk && (
                    <div className="doc-viewer__highlight">
                        <p>"{highlightedChunk.text}"</p>
                        <span className="doc-viewer__highlight-label">
                            Referenced in your last question
                        </span>
                    </div>
                )}

                {/* Sections from retrieved chunks */}
                {sections.length > 0 ? (
                    sections.map((s, i) => (
                        <div key={i} className="doc-viewer__section">
                            <h2 className="doc-viewer__section-heading">{i + 1}. {s.heading}</h2>
                            <p className="doc-viewer__section-body">{s.body}</p>
                        </div>
                    ))
                ) : (
                    /* Placeholder before any queries */
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <div className="doc-viewer__section">
                            <h2 className="doc-viewer__section-heading">Document ready for analysis</h2>
                            <p className="doc-viewer__section-body">
                                This document has been processed and indexed into {chunkCount} semantic chunks.
                                Ask a question in the chat panel to retrieve relevant content from this document.
                                The most relevant passages will be highlighted here as you explore.
                            </p>
                        </div>
                        <div className="doc-viewer__section">
                            <h2 className="doc-viewer__section-heading">How it works</h2>
                            <p className="doc-viewer__section-body">
                                Your question is embedded and matched against the document's chunks using
                                vector similarity search. A cross-encoder reranker then selects the most
                                precise passages to ground the answer — ensuring every response is cited
                                directly from the document.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── ChatPanel ──────────────────────────────────────────────────────────── */

function ChatPanel({ doc, onHighlight }) {
    const [input, setInput] = useState("");
    const messagesEndRef = useRef(null);

    const messages = useAppStore((s) => s.messages);
    const isQuerying = useAppStore((s) => s.isQuerying);
    const sendQuery = useAppStore((s) => s.sendQuery);
    const cancelQuery = useAppStore((s) => s.cancelQuery);
    const settings = useAppStore((s) => s.settings);
    const updateSettings = useAppStore((s) => s.updateSettings);

    // Scope retrieval to ONLY this document's chunks — without this,
    // since all docs share the same Pinecone namespace, queries would
    // silently search across every uploaded document instead of just this one.
    useEffect(() => {
        if (doc?.document_id) {
            updateSettings({
                namespace: doc.namespace || "",
                metadataFilter: { document_id: { $eq: doc.document_id } },
            });
        }
        // Reset scoping when leaving this document so other pages
        // (e.g. Dashboard, general chat) aren't accidentally filtered.
        return () => {
            updateSettings({ namespace: "", metadataFilter: null });
        };
    }, [doc?.document_id, doc?.namespace, updateSettings]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Highlight the first cited source after each assistant message
    useEffect(() => {
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant?.sources?.length) {
            onHighlight({
                text: lastAssistant.sources[0].text_preview,
                source: lastAssistant.sources[0].source,
            });
        }
    }, [messages, onHighlight]);

    const handleSend = useCallback(async () => {
        if (!input.trim() || isQuerying) return;
        const q = input.trim();
        setInput("");
        await sendQuery(q);
    }, [input, isQuerying, sendQuery]);

    const handleKey = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSuggestion = (q) => {
        setInput(q);
        setTimeout(() => handleSend(), 0);
    };

    const userCount = messages.filter((m) => m.role === "user").length;

    return (
        <div className="chat-panel">
            {/* Top bar */}
            <div className="chat-panel__topbar">
                <div className="chat-panel__title-row">
                    <div className="chat-panel__dot" />
                    <span className="chat-panel__title">Ask the Document</span>
                </div>
                <span className="chat-panel__count">
                    {userCount > 0 ? `${userCount * 2} messages` : "Ready"}
                </span>
            </div>

            {/* Messages */}
            <div className="chat-panel__messages">
                {messages.length === 0 && (
                    <div className="empty-state" style={{ flex: 1 }}>
                        <Zap size={24} color="var(--primary)" />
                        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                            Ask anything about <strong>{doc?.filename}</strong>
                        </span>
                    </div>
                )}

                {messages.map((msg) => (
                    msg.role === "user" ? (
                        <div key={msg.id} className="chat-msg-user">
                            <div className="chat-msg-user__bubble">{msg.content}</div>
                            <div className="chat-msg-user__avatar">
                                <User size={14} strokeWidth={1.8} />
                            </div>
                        </div>
                    ) : (
                        <div key={msg.id} className="chat-msg-ai">
                            <div className="chat-msg-ai__avatar">
                                <Zap size={13} strokeWidth={2.5} />
                            </div>
                            <div className="chat-msg-ai__body">
                                <div className="chat-msg-ai__bubble">
                                    {msg.isStreaming && !msg.content ? (
                                        <span className="streaming-dots">
                                            <span>·</span><span>·</span><span>·</span>
                                        </span>
                                    ) : msg.error ? (
                                        <span style={{ color: "#ef4444" }}>{msg.error}</span>
                                    ) : (
                                        msg.content
                                    )}
                                </div>
                                {/* Citation */}
                                {msg.sources?.[0] && (
                                    <div className="chat-msg-ai__citation">
                                        <BookOpen size={11} strokeWidth={2} />
                                        <span>{msg.sources[0].source}</span>
                                        {msg.latency_ms && (
                                            <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
                                                {msg.latency_ms}ms
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                ))}

                <div ref={messagesEndRef} />
            </div>

            {/* Suggested questions — only shown when no messages yet */}
            {messages.length === 0 && (
                <div className="chat-panel__suggestions">
                    <span className="chat-panel__suggestions-label">Suggested questions</span>
                    {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                            key={q}
                            className="suggestion-pill"
                            onClick={() => {
                                setInput(q);
                                sendQuery(q);
                            }}
                        >
                            {q}
                        </button>
                    ))}
                </div>
            )}

            {/* Input */}
            <div className="chat-panel__input-row">
                <div className="chat-panel__input-box">
                    <input
                        className="chat-panel__input"
                        placeholder="Ask anything about this document…"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        disabled={isQuerying}
                    />
                    <button
                        className="chat-panel__send-btn"
                        onClick={isQuerying ? cancelQuery : handleSend}
                        disabled={!input.trim() && !isQuerying}
                    >
                        <ArrowUp size={13} strokeWidth={2.5} />
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ── Document Picker (empty state) ──────────────────────────────────────── */

function DocumentPicker({ documents, onSelect, onUpload }) {
    return (
        <div
            style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 24,
                padding: 40,
            }}
        >
            <div style={{ textAlign: "center" }}>
                <FileText size={40} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                    Select a document to analyse
                </h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 280, lineHeight: 1.6 }}>
                    Choose from your uploaded documents or upload a new one to start asking questions.
                </p>
            </div>

            {documents.length > 0 && (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                        gap: 12,
                        width: "100%",
                        maxWidth: 640,
                    }}
                >
                    {documents.map((doc) => (
                        <button
                            key={doc.document_id}
                            onClick={() => onSelect(doc)}
                            style={{
                                background: "var(--bg-surface)",
                                border: "1px solid var(--border)",
                                borderRadius: "var(--radius-lg)",
                                padding: "16px",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "border-color 0.15s, background 0.15s",
                                fontFamily: "var(--font-body)",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = "var(--primary)";
                                e.currentTarget.style.background = "var(--primary-dim)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = "var(--border)";
                                e.currentTarget.style.background = "var(--bg-surface)";
                            }}
                        >
                            <div
                                style={{
                                    width: 32, height: 32,
                                    background: "var(--primary-dim)",
                                    borderRadius: "var(--radius-md)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    marginBottom: 10,
                                }}
                            >
                                <FileText size={14} color="var(--primary)" strokeWidth={2} />
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4, wordBreak: "break-word" }}>
                                {doc.filename}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {doc.chunks_total ?? "?"} chunks
                            </div>
                        </button>
                    ))}
                </div>
            )}

            <button className="btn-primary" onClick={onUpload}>
                <Upload size={14} strokeWidth={2.5} />
                Upload Document
            </button>
        </div>
    );
}

/* ── Upload Modal (inline) ──────────────────────────────────────────────── */

function UploadModal({ onClose, onUploaded }) {
    const { uploadFile, uploadQueue } = useDocuments();
    const fileRef = useRef();

    const handleFiles = async (files) => {
        for (const file of files) {
            await uploadFile(file);
        }
        onUploaded?.();
        onClose();
    };

    const handleDrop = (e) => {
        e.preventDefault();
        handleFiles([...e.dataTransfer.files]);
    };

    return (
        <div
            style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 9999,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "var(--bg-surface)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)", padding: 32, width: 400,
                    display: "flex", flexDirection: "column", gap: 16,
                }}
                onClick={(e) => e.stopPropagation()}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
            >
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                    Upload Document
                </h3>
                <div
                    style={{
                        border: "2px dashed var(--border)", borderRadius: "var(--radius-md)",
                        padding: "32px 20px", textAlign: "center", cursor: "pointer",
                        transition: "border-color 0.15s",
                    }}
                    onClick={() => fileRef.current?.click()}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--primary)"}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                >
                    <Upload size={24} color="var(--text-muted)" style={{ margin: "0 auto 8px" }} />
                    <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                        Drop files here or <span style={{ color: "var(--primary)" }}>click to browse</span>
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        PDF, DOCX, TXT, MD, HTML
                    </p>
                </div>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.html,.pptx,.xlsx,.xls"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => handleFiles([...e.target.files])}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="btn-ghost" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}

/* ── DocumentChatPage (main export) ─────────────────────────────────────── */

export default function DocumentChatPage() {
    const { documentId } = useParams();
    const navigate = useNavigate();
    const [selectedDoc, setSelectedDoc] = useState(null);
    const [highlightedChunk, setHighlightedChunk] = useState(null);
    const [showUpload, setShowUpload] = useState(false);

    const { documents, refreshStats } = useDocuments();
    const clearChat = useAppStore((s) => s.clearChat);
    const messages = useAppStore((s) => s.messages);
    const saveChatSession = useAppStore((s) => s.saveChatSession);

    // Snapshot this document's conversation into chatSessions as it grows,
    // so the Chat History page has real data to show.
    useEffect(() => {
        if (selectedDoc && messages.length > 0 && saveChatSession) {
            saveChatSession(selectedDoc.document_id, selectedDoc.filename, messages);
        }
    }, [messages, selectedDoc, saveChatSession]);

    // When a document is selected, clear previous chat and sync URL
    const handleSelectDoc = useCallback((doc) => {
        setSelectedDoc(doc);
        setHighlightedChunk(null);
        clearChat();
        navigate(`/chat/${doc.document_id}`, { replace: true });
    }, [clearChat, navigate]);

    // Auto-select document from URL param (e.g. arriving from DocumentsPage)
    useEffect(() => {
        if (documentId && documents.length > 0) {
            const match = documents.find((d) => d.document_id === documentId);
            if (match && match.document_id !== selectedDoc?.document_id) {
                setSelectedDoc(match);
                setHighlightedChunk(null);
                clearChat();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentId, documents]);

    // After upload, refresh docs and auto-select the newest one
    const handleUploaded = useCallback(() => {
        refreshStats();
        // The newest doc will be at index 0 after store updates
        setTimeout(() => {
            const docs = useAppStore.getState().documents;
            if (docs.length > 0) handleSelectDoc(docs[0]);
        }, 500);
    }, [refreshStats, handleSelectDoc]);

    return (
        <div className="doc-chat-page">

            {selectedDoc ? (
                <>
                    {/* Back button */}
                    <div style={{ position: "absolute", top: 14, left: 80, zIndex: 20 }}>
                        <button
                            className="btn-ghost"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                            onClick={() => { setSelectedDoc(null); setHighlightedChunk(null); clearChat(); navigate("/chat"); }}
                        >
                            <ChevronLeft size={13} strokeWidth={2} />
                            Documents
                        </button>
                    </div>

                    {/* Split view */}
                    <DocViewer doc={selectedDoc} highlightedChunk={highlightedChunk} />
                    <ChatPanel
                        doc={selectedDoc}
                        onHighlight={setHighlightedChunk}
                    />
                </>
            ) : (
                <DocumentPicker
                    documents={documents}
                    onSelect={handleSelectDoc}
                    onUpload={() => setShowUpload(true)}
                />
            )}

            {showUpload && (
                <UploadModal
                    onClose={() => setShowUpload(false)}
                    onUploaded={handleUploaded}
                />
            )}
        </div>
    );
}