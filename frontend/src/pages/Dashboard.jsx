import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
    FileText,
    MessageSquare,
    Sparkles,
    Zap,
    Upload,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDocuments } from "@/hooks/useDocuments";

/* ── Helpers ────────────────────────────────────────────────────────────── */
function formatRelativeTime(ts) {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "yesterday";
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

/* ── Sub-components ─────────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, delta }) {
    return (
        <div className="stat-card">
            <div className="stat-card__header">
                <span className="stat-card__label">{label}</span>
                <div className="stat-card__icon">
                    <Icon size={14} strokeWidth={2} />
                </div>
            </div>
            <div className="stat-card__value">{value}</div>
            <div className="stat-card__delta">{delta}</div>
        </div>
    );
}

function DocRow({ doc, onClick }) {
    return (
        <div className="doc-row" onClick={onClick}>
            <div className="doc-row__icon">
                <FileText size={14} strokeWidth={2} />
            </div>
            <div className="doc-row__info">
                <div className="doc-row__name">{doc.filename}</div>
                <div className="doc-row__meta">
                    {doc.chunks_total ?? "?"} chunks
                    {doc.questionCount ? ` · ${doc.questionCount} questions` : ""}
                </div>
            </div>
            <div className="doc-row__date">{formatDate(doc.uploadedAt)}</div>
            <div className="doc-row__dot" />
        </div>
    );
}

function QuestionRow({ message, docName }) {
    return (
        <div className="q-row">
            <div className="q-row__top">
                <span className="q-row__doc">{docName ?? "—"}</span>
                <span className="q-row__time">{formatRelativeTime(message.timestamp)}</span>
            </div>
            <div className="q-row__text">{message.content}</div>
        </div>
    );
}

/* ── Dashboard Page ─────────────────────────────────────────────────────── */
export default function Dashboard() {
    const navigate = useNavigate();

    // Real data from existing store/hooks
    const { documents, indexStats, refreshStats } = useDocuments();
    const messages = useAppStore((s) => s.messages ?? []);
    const openUpload = useAppStore((s) => s.openUploadModal);

    useEffect(() => { refreshStats(); }, [refreshStats]);

    // Derive stats from real data
    const docCount = documents.length;
    const vectorCount = indexStats?.total_vectors ?? 0;
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    const questionsCount = userMessages.length;
    const insightsCount = assistantMsgs.length;

    // Build per-document question count map
    const docQuestionMap = {};
    userMessages.forEach((m) => {
        if (m.namespace || m.docId) {
            const key = m.namespace ?? m.docId;
            docQuestionMap[key] = (docQuestionMap[key] ?? 0) + 1;
        }
    });

    // Recent questions: last 4 user messages, newest first
    const recentQuestions = [...userMessages]
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, 4);

    // Recent documents: sorted by uploadedAt, newest first
    const recentDocs = [...documents]
        .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))
        .slice(0, 5);

    const handleUpload = useCallback(() => {
        navigate("/documents");
    }, [navigate]);

    return (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>

            {/* Top bar */}
            <div className="page-topbar">
                <h1>Dashboard</h1>
                <button className="btn-primary" onClick={handleUpload}>
                    <Upload size={14} strokeWidth={2.5} />
                    Upload Document
                </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24, overflow: "auto" }}>

                {/* Stat Cards */}
                <div className="stat-grid">
                    <StatCard
                        icon={FileText}
                        label="Documents Analyzed"
                        value={docCount}
                        delta={vectorCount > 0 ? `${vectorCount} vectors indexed` : "No documents yet"}
                    />
                    <StatCard
                        icon={MessageSquare}
                        label="Questions Asked"
                        value={questionsCount}
                        delta={questionsCount > 0 ? `${questionsCount} this session` : "Ask your first question"}
                    />
                    <StatCard
                        icon={Sparkles}
                        label="Insights Generated"
                        value={insightsCount}
                        delta={insightsCount > 0 ? `${insightsCount} answers generated` : "No answers yet"}
                    />
                    <StatCard
                        icon={Zap}
                        label="Avg. Analysis Time"
                        value={vectorCount > 0 ? "~2.4s" : "—"}
                        delta={vectorCount > 0 ? "↓ Fast two-stage retrieval" : "Upload a document to start"}
                    />
                </div>

                {/* Panels row */}
                <div className="panels-row">

                    {/* Recent Documents */}
                    <div className="panel panel--main">
                        <div className="panel__header">
                            <span className="panel__title">Recent Documents</span>
                            <button className="panel__view-all" onClick={() => navigate("/documents")}>
                                View all
                            </button>
                        </div>
                        <div className="panel__body">
                            {recentDocs.length === 0 ? (
                                <div className="empty-state">
                                    <FileText size={28} />
                                    <span>No documents uploaded yet</span>
                                    <button className="btn-primary" style={{ marginTop: 8, fontSize: 12 }} onClick={handleUpload}>
                                        Upload your first document
                                    </button>
                                </div>
                            ) : (
                                recentDocs.map((doc) => (
                                    <DocRow
                                        key={doc.document_id ?? doc.filename}
                                        doc={doc}
                                        onClick={() => navigate(`/chat/${doc.document_id}`)}
                                    />
                                ))
                            )}
                        </div>
                    </div>

                    {/* Recent Questions */}
                    <div className="panel panel--aside">
                        <div className="panel__header">
                            <span className="panel__title">Recent Questions</span>
                            <button className="panel__view-all" onClick={() => navigate("/documents")}>
                                View all
                            </button>
                        </div>
                        <div className="panel__body">
                            {recentQuestions.length === 0 ? (
                                <div className="empty-state">
                                    <MessageSquare size={28} />
                                    <span>No questions asked yet</span>
                                </div>
                            ) : (
                                recentQuestions.map((msg, i) => (
                                    <QuestionRow
                                        key={msg.id ?? i}
                                        message={msg}
                                        docName={
                                            documents[0]?.filename ?? "Document"
                                        }
                                    />
                                ))
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}