/**
 * InsightsPage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * For every uploaded document, shows:
 *   1. "Key Topics" — a REAL Gemini-generated summary, scoped to ONLY that
 *      document's chunks via metadata_filter={document_id: doc.document_id}.
 *      Generated on-demand (button click) and cached in the store so it
 *      doesn't re-run on every page visit.
 *   2. "Asked by You" — REAL past questions from that document's chat
 *      history (chatSessions slice, populated live as you chat).
 *
 * No fabricated numbers, themes, or categories — everything here is either
 * pulled from real app state or generated live by the actual RAG pipeline.
 */

import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
    FileText, Sparkles, RefreshCw, MessageSquare, Wand2,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDocuments } from "@/hooks/useDocuments";
import { queryRAG } from "@/services/api";

const INSIGHT_PROMPT =
    "What are the most important topics, points, or pieces of information in " +
    "this document? Give a concise summary as 3-5 short points.";

/* ── Single document insight card ──────────────────────────────────────── */

function DocInsightCard({ doc, cached, sessionQuestions, onGenerate }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        try {
            await onGenerate(doc);
        } catch (err) {
            setError(err?.message ?? "Failed to generate insights.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="insight-card">
            <div className="insight-card__header">
                <div className="insight-card__title-row">
                    <div className="insight-card__icon">
                        <FileText size={14} strokeWidth={2} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div className="insight-card__title">{doc.filename}</div>
                        <div className="insight-card__meta">{doc.chunks_total ?? 0} chunks</div>
                    </div>
                </div>
                {cached && (
                    <button
                        className="insight-card__regen-btn"
                        onClick={handleGenerate}
                        disabled={loading}
                        title="Regenerate"
                    >
                        <RefreshCw size={13} className={loading ? "spin" : ""} />
                    </button>
                )}
            </div>

            {/* System-generated key topics */}
            {!cached && !loading && (
                <button className="insight-card__generate-btn" onClick={handleGenerate}>
                    <Wand2 size={13} strokeWidth={2} />
                    Generate Key Topics
                </button>
            )}

            {loading && (
                <p className="insight-card__summary" style={{ color: "var(--text-muted)" }}>
                    Analyzing document…
                </p>
            )}

            {error && (
                <p className="insight-card__summary" style={{ color: "#ef4444" }}>{error}</p>
            )}

            {cached && !loading && (
                <p className="insight-card__summary">{cached.summary}</p>
            )}

            {/* Asked by you */}
            {sessionQuestions.length > 0 && (
                <>
                    <div className="insight-card__divider" />
                    <span className="insight-card__section-label">Asked by you</span>
                    <div className="insight-card__questions">
                        {sessionQuestions.map((q, i) => (
                            <div key={i} className="insight-question-pill">{q}</div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/* ── InsightsPage ───────────────────────────────────────────────────────── */

export default function InsightsPage() {
    const navigate = useNavigate();
    const { documents } = useDocuments();
    const chatSessions = useAppStore((s) => s.chatSessions);

    // Additive cache slice (see appStore patch instructions)
    const docInsights = useAppStore((s) => s.docInsights);
    const saveDocInsight = useAppStore((s) => s.saveDocInsight);

    const handleGenerate = useCallback(async (doc) => {
        const result = await queryRAG({
            question: INSIGHT_PROMPT,
            metadataFilter: { document_id: { $eq: doc.document_id } },
            topK: Math.min(doc.chunks_total ?? 10, 20),
            topN: Math.min(doc.chunks_total ?? 5, 8),
        });
        saveDocInsight?.(doc.document_id, {
            summary: result.answer,
            sources: result.sources,
            generatedAt: Date.now(),
        });
    }, [saveDocInsight]);

    // Real stats — no fabricated numbers
    const generatedCount = Object.keys(docInsights ?? {}).length;
    const totalQuestions = useMemo(() => {
        return Object.values(chatSessions ?? {}).reduce(
            (sum, session) => sum + (session.messages?.filter((m) => m.role === "user").length ?? 0),
            0
        );
    }, [chatSessions]);

    return (
        <div className="insights-page">
            <div className="page-topbar">
                <h1>Insights</h1>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {documents.length} document{documents.length === 1 ? "" : "s"} uploaded
                </span>
            </div>

            <div className="insights-page__body">

                {/* Main column — per-document cards */}
                <div className="insights-main">
                    {documents.length === 0 ? (
                        <div className="empty-state" style={{ flex: 1 }}>
                            <Sparkles size={28} />
                            <span>Upload a document to generate insights</span>
                            <button className="btn-primary" style={{ marginTop: 8, fontSize: 12 }} onClick={() => navigate("/documents")}>
                                Go to Documents
                            </button>
                        </div>
                    ) : (
                        documents.map((doc) => {
                            const session = chatSessions?.[doc.document_id];
                            const sessionQuestions = (session?.messages ?? [])
                                .filter((m) => m.role === "user")
                                .map((m) => m.content);

                            return (
                                <DocInsightCard
                                    key={doc.document_id}
                                    doc={doc}
                                    cached={docInsights?.[doc.document_id]}
                                    sessionQuestions={sessionQuestions}
                                    onGenerate={handleGenerate}
                                />
                            );
                        })
                    )}
                </div>

                {/* Aside — real stats only */}
                <div className="insights-aside">
                    <div className="insights-stat">
                        <span className="insights-stat__label">Documents Uploaded</span>
                        <span className="insights-stat__value">{documents.length}</span>
                    </div>
                    <div className="insights-stat">
                        <span className="insights-stat__label">Insights Generated</span>
                        <span className="insights-stat__value">{generatedCount}</span>
                        {generatedCount < documents.length && documents.length > 0 && (
                            <span className="insights-stat__sub">
                                {documents.length - generatedCount} remaining
                            </span>
                        )}
                    </div>
                    <div className="insights-stat">
                        <span className="insights-stat__label">Questions Asked</span>
                        <span className="insights-stat__value">{totalQuestions}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}