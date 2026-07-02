import { useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
    AreaChart, Area, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
    FileText, MessageSquare, Sparkles, Zap, Upload,
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

/* ── Build last-14-days chart data from real chatSessions ─────────────── */
function buildChartData(chatSessions) {
    // Build day → question count map from all session messages
    const dayCounts = {};

    // Seed 14 days so the chart always shows a full range even with no data
    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        dayCounts[key] = 0;
    }

    Object.values(chatSessions ?? {}).forEach((session) => {
        (session.messages ?? []).forEach((msg) => {
            if (msg.role !== "user" || !msg.timestamp) return;
            const key = new Date(msg.timestamp).toLocaleDateString(
                "en-US", { month: "short", day: "numeric" }
            );
            if (key in dayCounts) {
                dayCounts[key] += 1;
            }
        });
    });

    return Object.entries(dayCounts).map(([day, questions]) => ({ day, questions }));
}

/* ── Custom tooltip ──────────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: "var(--bg-surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "8px 14px",
            fontSize: 12,
        }}>
            <p style={{ color: "var(--text-muted)", marginBottom: 2 }}>{label}</p>
            <p style={{ color: "var(--primary)", fontWeight: 600 }}>
                {payload[0].value} question{payload[0].value !== 1 ? "s" : ""}
            </p>
        </div>
    );
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

    const { documents, indexStats, refreshStats } = useDocuments();
    const chatSessions = useAppStore((s) => s.chatSessions ?? {});

    useEffect(() => { refreshStats(); }, [refreshStats]);

    // Aggregate real stats across ALL sessions (not just current session)
    const { totalQuestions, totalAnswers, recentQuestions } = useMemo(() => {
        let qCount = 0;
        let aCount = 0;
        const allUserMsgs = [];

        Object.values(chatSessions).forEach((session) => {
            (session.messages ?? []).forEach((msg) => {
                if (msg.role === "user") { qCount++; allUserMsgs.push({ ...msg, _docName: session.filename }); }
                if (msg.role === "assistant") { aCount++; }
            });
        });

        const recent = allUserMsgs
            .filter((m) => m.timestamp)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 4);

        return { totalQuestions: qCount, totalAnswers: aCount, recentQuestions: recent };
    }, [chatSessions]);

    const docCount = documents.length;
    const vectorCount = indexStats?.total_vectors ?? 0;

    const recentDocs = useMemo(() =>
        [...documents]
            .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))
            .slice(0, 5),
        [documents]);

    // Real chart data derived from session timestamps
    const chartData = useMemo(() => buildChartData(chatSessions), [chatSessions]);
    const chartMax = Math.max(...chartData.map((d) => d.questions), 5);
    const hasActivity = chartData.some((d) => d.questions > 0);

    const handleUpload = useCallback(() => { navigate("/documents"); }, [navigate]);

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
            <div style={{
                flex: 1, padding: "24px 32px",
                display: "flex", flexDirection: "column", gap: 24, overflow: "auto",
            }}>

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
                        value={totalQuestions}
                        delta={totalQuestions > 0 ? "Across all sessions" : "Ask your first question"}
                    />
                    <StatCard
                        icon={Sparkles}
                        label="Insights Generated"
                        value={totalAnswers}
                        delta={totalAnswers > 0 ? "Answers generated" : "No answers yet"}
                    />
                    <StatCard
                        icon={Zap}
                        label="Avg. Analysis Time"
                        value={vectorCount > 0 ? "~2.4s" : "—"}
                        delta={vectorCount > 0 ? "↓ Two-stage retrieval" : "Upload a document to start"}
                    />
                </div>

                {/* Activity Chart */}
                <div className="panel" style={{ padding: 0 }}>
                    <div className="panel__header">
                        <span className="panel__title">Activity — Questions per day</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Last 14 days</span>
                    </div>
                    <div style={{ padding: "20px 24px 16px" }}>
                        {!hasActivity ? (
                            <div className="empty-state" style={{ padding: "32px 0", minHeight: 120 }}>
                                <MessageSquare size={20} />
                                <span>No activity yet — start asking questions to see your usage here</span>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={160}>
                                <AreaChart
                                    data={chartData}
                                    margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid
                                        strokeDasharray="3 3"
                                        stroke="var(--border)"
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="day"
                                        tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                                        tickLine={false}
                                        axisLine={false}
                                        interval={1}
                                    />
                                    <YAxis
                                        tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                                        tickLine={false}
                                        axisLine={false}
                                        allowDecimals={false}
                                        domain={[0, chartMax + 1]}
                                    />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Area
                                        type="monotone"
                                        dataKey="questions"
                                        stroke="#22c55e"
                                        strokeWidth={2}
                                        fill="url(#activityGradient)"
                                        dot={false}
                                        activeDot={{ r: 4, fill: "#22c55e", strokeWidth: 0 }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
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
                                    <button
                                        className="btn-primary"
                                        style={{ marginTop: 8, fontSize: 12 }}
                                        onClick={handleUpload}
                                    >
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
                            <button className="panel__view-all" onClick={() => navigate("/history")}>
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
                                        docName={msg._docName}
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