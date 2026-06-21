/**
 * SettingsPage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Wires up the `settings` slice that already exists in appStore (topK,
 * topN, namespace, streamEnabled) — previously unused by any UI.
 *
 * Also surfaces real backend health (fetchHealth, already in store) and
 * gives real, working controls to clear locally-cached data
 * (chatSessions, docInsights) — both genuinely stored client-side.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Trash2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDocuments } from "@/hooks/useDocuments";

function Toggle({ on, onChange }) {
    return (
        <button className={`settings-toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}>
            <div className="settings-toggle__thumb" />
        </button>
    );
}

export default function SettingsPage() {
    const navigate = useNavigate();
    const settings = useAppStore((s) => s.settings);
    const updateSettings = useAppStore((s) => s.updateSettings);
    const health = useAppStore((s) => s.health);
    const healthLoading = useAppStore((s) => s.healthLoading);
    const fetchHealth = useAppStore((s) => s.fetchHealth);

    const chatSessions = useAppStore((s) => s.chatSessions);
    const docInsights = useAppStore((s) => s.docInsights);
    const clearChatSessions = useAppStore((s) => s.clearChatSessions);
    const clearDocInsights = useAppStore((s) => s.clearDocInsights);

    const { documents } = useDocuments();

    const [topK, setTopK] = useState(settings.topK ?? "");
    const [topN, setTopN] = useState(settings.topN ?? "");
    const [namespace, setNamespace] = useState(settings.namespace ?? "");

    useEffect(() => { fetchHealth(); }, [fetchHealth]);

    const commitTopK = () => updateSettings({ topK: topK === "" ? null : Number(topK) });
    const commitTopN = () => updateSettings({ topN: topN === "" ? null : Number(topN) });
    const commitNamespace = () => updateSettings({ namespace: namespace.trim() });

    const sessionCount = Object.keys(chatSessions ?? {}).length;
    const insightCount = Object.keys(docInsights ?? {}).length;

    const handleClearHistory = () => {
        if (confirm(`Clear all ${sessionCount} chat session(s)? This can't be undone.`)) {
            clearChatSessions?.();
        }
    };

    const handleClearInsights = () => {
        if (confirm(`Clear ${insightCount} generated insight(s)? You can regenerate them anytime.`)) {
            clearDocInsights?.();
        }
    };

    return (
        <div className="settings-page">
            <div className="page-topbar">
                <h1>Settings</h1>
            </div>

            <div className="settings-page__body">

                {/* Retrieval settings */}
                <div className="settings-section">
                    <div className="settings-section__header">
                        <div className="settings-section__title">Retrieval</div>
                        <div className="settings-section__desc">
                            Controls how documents are searched and ranked before generation
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">Stream responses</div>
                            <div className="settings-row__desc">
                                Show answers token-by-token as they're generated, instead of waiting for the full response
                            </div>
                        </div>
                        <div className="settings-row__control">
                            <Toggle
                                on={settings.streamEnabled}
                                onChange={(val) => updateSettings({ streamEnabled: val })}
                            />
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">Retrieval candidates (top-K)</div>
                            <div className="settings-row__desc">
                                How many chunks Pinecone retrieves before reranking. Higher = broader but slower.
                            </div>
                        </div>
                        <div className="settings-row__control">
                            <input
                                className="settings-input"
                                type="number"
                                placeholder="Auto (20)"
                                value={topK}
                                onChange={(e) => setTopK(e.target.value)}
                                onBlur={commitTopK}
                                min={1}
                                max={100}
                            />
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">Final context chunks (top-N)</div>
                            <div className="settings-row__desc">
                                How many reranked chunks are actually sent to Gemini for generation.
                            </div>
                        </div>
                        <div className="settings-row__control">
                            <input
                                className="settings-input"
                                type="number"
                                placeholder="Auto (5)"
                                value={topN}
                                onChange={(e) => setTopN(e.target.value)}
                                onBlur={commitTopN}
                                min={1}
                                max={20}
                            />
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">Namespace override</div>
                            <div className="settings-row__desc">
                                Restrict retrieval to a specific Pinecone namespace. Leave blank for "default".
                            </div>
                        </div>
                        <div className="settings-row__control">
                            <input
                                className="settings-input settings-input--wide"
                                type="text"
                                placeholder="default"
                                value={namespace}
                                onChange={(e) => setNamespace(e.target.value)}
                                onBlur={commitNamespace}
                            />
                        </div>
                    </div>
                </div>

                {/* Connection */}
                <div className="settings-section">
                    <div className="settings-section__header">
                        <div className="settings-section__title">Connection</div>
                        <div className="settings-section__desc">Live status of the FastAPI backend</div>
                    </div>
                    <div className="settings-row">
                        <div className="settings-health">
                            <span className={`settings-health__dot ${healthLoading ? "loading" : health?.status === "ok" ? "ok" : "error"
                                }`} />
                            <span>
                                {healthLoading
                                    ? "Checking…"
                                    : health?.status === "ok"
                                        ? `Connected — v${health.version ?? "—"}`
                                        : "Disconnected"}
                            </span>
                        </div>
                        <button className="btn-ghost" onClick={fetchHealth}>
                            <RefreshCw size={12} strokeWidth={2} className={healthLoading ? "spin" : ""} />
                            Check now
                        </button>
                    </div>
                </div>

                {/* Data */}
                <div className="settings-section">
                    <div className="settings-section__header">
                        <div className="settings-section__title">Data</div>
                        <div className="settings-section__desc">
                            Locally cached data — stored in your browser, not on the server
                        </div>
                    </div>

                    <div className="settings-stat-row">
                        <div className="settings-stat-row__item">
                            <span className="settings-stat-row__value">{documents.length}</span>
                            <span className="settings-stat-row__label">Documents</span>
                        </div>
                        <div className="settings-stat-row__item">
                            <span className="settings-stat-row__value">{sessionCount}</span>
                            <span className="settings-stat-row__label">Chat Sessions</span>
                        </div>
                        <div className="settings-stat-row__item">
                            <span className="settings-stat-row__value">{insightCount}</span>
                            <span className="settings-stat-row__label">Insights Cached</span>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">Clear chat history</div>
                            <div className="settings-row__desc">
                                Removes all locally-saved conversation transcripts
                            </div>
                        </div>
                        <button className="btn-danger" onClick={handleClearHistory} disabled={sessionCount === 0}>
                            <Trash2 size={12} strokeWidth={2} />
                            Clear
                        </button>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">Clear cached insights</div>
                            <div className="settings-row__desc">
                                Removes generated key-topic summaries (can be regenerated anytime)
                            </div>
                        </div>
                        <button className="btn-danger" onClick={handleClearInsights} disabled={insightCount === 0}>
                            <Trash2 size={12} strokeWidth={2} />
                            Clear
                        </button>
                    </div>
                </div>

                {/* About */}
                <div className="settings-section">
                    <div className="settings-section__header">
                        <div className="settings-section__title">About</div>
                    </div>
                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">DeepContext Engine</div>
                            <div className="settings-row__desc">
                                Two-stage retrieval RAG pipeline — Pinecone ANN search + cross-encoder reranking,
                                powered by Gemini.
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}