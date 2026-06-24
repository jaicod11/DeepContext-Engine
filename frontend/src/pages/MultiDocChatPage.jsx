/**
 * MultiDocChatPage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Lets you ask questions across a SELECTED SUBSET of documents (2-3),
 * instead of one document or your whole library.
 *
 * Uses Pinecone's native `$in` metadata filter operator — same mechanism
 * as the single-document scoping fix in DocumentChatPage, just with a
 * list of document_ids instead of one. No backend changes required.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { FileText, X, User, Zap, BookOpen, ArrowUp } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDocuments } from "@/hooks/useDocuments";

function citationLabel(source) {
    if (source.page_number != null) return `Page ${source.page_number}`;
    if (source.slide_number != null) return `Slide ${source.slide_number}`;
    if (source.sheet_name) return `Sheet: ${source.sheet_name}`;
    return null;
}


const COMPARE_SUGGESTIONS = [
    "What do these documents have in common?",
    "What are the key differences between them?",
    "Summarize each document separately",
];

export default function MultiDocChatPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { documents } = useDocuments();

    const messages = useAppStore((s) => s.messages);
    const isQuerying = useAppStore((s) => s.isQuerying);
    const sendQuery = useAppStore((s) => s.sendQuery);
    const cancelQuery = useAppStore((s) => s.cancelQuery);
    const clearChat = useAppStore((s) => s.clearChat);
    const updateSettings = useAppStore((s) => s.updateSettings);

    const [input, setInput] = useState("");
    const messagesEndRef = useRef(null);

    // Resolve selected documents from the URL
    const ids = (searchParams.get("docs") ?? "").split(",").filter(Boolean);
    const selectedDocs = documents.filter((d) => ids.includes(d.document_id));

    // Scope retrieval to exactly these documents; clean up on unmount
    useEffect(() => {
        if (ids.length > 0) {
            clearChat();
            updateSettings({
                namespace: "",
                metadataFilter: { document_id: { $in: ids } },
            });
        }
        return () => updateSettings({ namespace: "", metadataFilter: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.get("docs")]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

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

    if (selectedDocs.length < 2) {
        return (
            <div className="doc-viewer__empty" style={{ flex: 1 }}>
                <FileText size={32} color="var(--text-muted)" />
                <h3>Select at least 2 documents to compare</h3>
                <p>Go to Documents, enable compare mode, and pick 2-3 files.</p>
                <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => navigate("/documents")}>
                    Go to Documents
                </button>
            </div>
        );
    }

    return (
        <div className="multidoc-page">
            {/* Top bar */}
            <div className="multidoc-page__topbar">
                <div className="multidoc-page__title-row">
                    <span className="multidoc-page__title">
                        Comparing {selectedDocs.length} documents
                    </span>
                    <button className="btn-ghost" onClick={() => navigate("/documents")}>
                        <X size={12} strokeWidth={2} />
                        Exit comparison
                    </button>
                </div>
                <div className="multidoc-page__chips">
                    {selectedDocs.map((d) => (
                        <div key={d.document_id} className="multidoc-chip">
                            <FileText size={11} strokeWidth={2} />
                            {d.filename}
                        </div>
                    ))}
                </div>
            </div>

            {/* Chat */}
            <div className="multidoc-page__body">
                <div className="multidoc-chat">
                    <div className="multidoc-chat__messages">
                        {messages.length === 0 && (
                            <div className="empty-state" style={{ flex: 1 }}>
                                <Zap size={24} color="var(--primary)" />
                                <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                                    Ask a question across these {selectedDocs.length} documents
                                </span>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, width: "100%", maxWidth: 360 }}>
                                    {COMPARE_SUGGESTIONS.map((q) => (
                                        <button
                                            key={q}
                                            className="suggestion-pill"
                                            onClick={() => sendQuery(q)}
                                        >
                                            {q}
                                        </button>
                                    ))}
                                </div>
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
                                    <div className="chat-msg-ai__body" style={{ maxWidth: 480 }}>
                                        <div className="chat-msg-ai__bubble">
                                            {msg.isStreaming && !msg.content ? (
                                                <span className="streaming-dots"><span>·</span><span>·</span><span>·</span></span>
                                            ) : msg.error ? (
                                                <span style={{ color: "#ef4444" }}>{msg.error}</span>
                                            ) : (
                                                msg.content
                                            )}
                                        </div>
                                        {msg.sources?.length > 0 && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                {msg.sources.slice(0, 4).map((src, si) => (
                                                    <div key={si} className="chat-msg-ai__citation">
                                                        <BookOpen size={11} strokeWidth={2} />
                                                        <span>
                                                            {src.source}
                                                            {citationLabel(src) ? ` · ${citationLabel(src)}` : ""}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="multidoc-chat__input-row">
                        <div className="chat-panel__input-box">
                            <input
                                className="chat-panel__input"
                                placeholder={`Ask anything about these ${selectedDocs.length} documents…`}
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
            </div>
        </div>
    );
}