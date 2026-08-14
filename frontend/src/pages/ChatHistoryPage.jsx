/**
 * ChatHistoryPage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Lists past chat sessions, one per document, read from the real
 * `chatSessions` slice in appStore (snapshotted live as you chat in
 * DocumentChatPage — see the useEffect there).
 *
 * This data is genuinely persisted (localStorage via zustand persist),
 * not mocked. If no conversations have happened yet, this page is
 * honestly empty rather than showing placeholder numbers.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Search, Zap, User, BookOpen, MessageSquare } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

function citationLabel(source) {
    if (!source) return "";
    if (source.page_number != null) return `Page ${source.page_number}`;
    if (source.slide_number != null) return `Slide ${source.slide_number}`;
    if (source.sheet_name) return `Sheet: ${source.sheet_name}`;
    return "";
}


/* ── Helpers ────────────────────────────────────────────────────────────── */

function formatRelativeTime(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString("en-US", {
        month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    });
}

/* ── Session row (left list) ───────────────────────────────────────────── */

function SessionRow({ session, active, onClick }) {
    const lastUserMsg = [...session.messages].reverse().find((m) => m.role === "user");

    return (
        <button className={`history-row${active ? " active" : ""}`} onClick={onClick}>
            <div className="history-row__top">
                <div className="history-row__filename-wrap">
                    <FileText size={12} strokeWidth={2} color={active ? "var(--primary)" : "var(--text-muted)"} />
                    <span className="history-row__filename">{session.filename}</span>
                </div>
                <span className="history-row__time">{formatRelativeTime(session.updatedAt)}</span>
            </div>
            <p className="history-row__question">{lastUserMsg?.content ?? "—"}</p>
            <span className="history-row__count">{session.messages.length} messages</span>
        </button>
    );
}

/* ── Transcript bubble (right panel, read-only) ────────────────────────── */

function TranscriptBubble({ msg }) {
    if (msg.role === "user") {
        return (
            <div className="chat-msg-user">
                <div className="chat-msg-user__bubble">{msg.content}</div>
                <div className="chat-msg-user__avatar">
                    <User size={14} strokeWidth={1.8} />
                </div>
            </div>
        );
    }

    return (
        <div className="chat-msg-ai">
            <div className="chat-msg-ai__avatar">
                <Zap size={13} strokeWidth={2.5} />
            </div>
            <div className="chat-msg-ai__body">
                <div className="chat-msg-ai__bubble">
                    {msg.error ? <span style={{ color: "var(--danger)" }}>{msg.error}</span> : msg.content}
                </div>
                {msg.sources?.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {msg.sources.slice(0, 3).map((src, si) => {
                            const label = citationLabel(src);
                            return (
                                <div key={si} className="chat-msg-ai__citation">
                                    <BookOpen size={11} strokeWidth={2} />
                                    <span>
                                        {src.source}{label ? ` · ${label}` : ""}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── ChatHistoryPage ────────────────────────────────────────────────────── */


function stripSourceTags(text) {
    if (!text) return text;
    return text.replace(/\[SOURCE \d+\]/gi, "").replace(/\s{2,}/g, " ").trim();
}

export default function ChatHistoryPage() {
    const navigate = useNavigate();
    const chatSessions = useAppStore((s) => s.chatSessions);
    const [search, setSearch] = useState("");

    const sessions = useMemo(() => {
        let list = Object.values(chatSessions ?? {})
            .filter((s) => s.messages?.length > 0)
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((s) =>
                s.filename.toLowerCase().includes(q) ||
                s.messages.some((m) => m.content?.toLowerCase().includes(q))
            );
        }
        return list;
    }, [chatSessions, search]);

    const [selectedId, setSelectedId] = useState(null);
    const selected = sessions.find((s) => s.documentId === selectedId) ?? sessions[0] ?? null;

    return (
        <div className="history-page">

            {/* Left: session list */}
            <div className="history-sidebar">
                <div className="history-sidebar__topbar">
                    <span className="history-sidebar__title">Chat History</span>
                    <span className="history-sidebar__count">
                        {sessions.length} session{sessions.length === 1 ? "" : "s"}
                    </span>
                </div>

                <div className="history-sidebar__search">
                    <div className="history-sidebar__search-box">
                        <Search size={13} strokeWidth={2} color="var(--text-muted)" />
                        <input
                            placeholder="Search conversations…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                <div className="history-sidebar__list">
                    {sessions.length === 0 ? (
                        <div className="empty-state" style={{ padding: "40px 20px" }}>
                            <MessageSquare size={24} />
                            <span>No conversations yet</span>
                        </div>
                    ) : (
                        sessions.map((s) => (
                            <SessionRow
                                key={s.documentId}
                                session={s}
                                active={selected?.documentId === s.documentId}
                                onClick={() => setSelectedId(s.documentId)}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* Right: transcript */}
            <div className="history-main">
                {selected ? (
                    <>
                        <div className="history-main__topbar">
                            <div className="history-main__doc-info">
                                <div className="history-main__doc-icon">
                                    <FileText size={13} strokeWidth={2} />
                                </div>
                                <div>
                                    <span className="history-main__doc-name">{selected.filename}</span>
                                    <span className="history-main__doc-meta">
                                        {selected.messages.length} messages · {formatFullDate(selected.updatedAt)}
                                    </span>
                                </div>
                            </div>
                            <button
                                className="history-main__open-btn"
                                onClick={() => navigate(`/chat/${selected.documentId}`)}
                            >
                                <FileText size={12} strokeWidth={2} />
                                Open Document
                            </button>
                        </div>

                        <div className="history-main__messages">
                            {selected.messages.map((msg) => (
                                <TranscriptBubble key={msg.id} msg={msg} />
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="doc-viewer__empty" style={{ flex: 1 }}>
                        <MessageSquare size={32} color="var(--text-muted)" />
                        <h3>No conversations yet</h3>
                        <p>Start a conversation from any document and it'll show up here.</p>
                        <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => navigate("/documents")}>
                            Go to Documents
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}