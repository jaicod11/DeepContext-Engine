/**
 * components/layout/TopBar.jsx
 * -----------------------------
 * App-wide top navigation bar.
 *
 * Shows:
 *   • Sidebar toggle
 *   • App title
 *   • Active model badge
 *   • Pinecone health dot
 *   • Stream toggle
 *   • Clear chat
 *   • Citations panel toggle
 */

import { useEffect } from "react";
import {
  PanelLeft,
  Zap,
  ZapOff,
  Trash2,
  BookOpen,
  Activity,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";

export default function TopBar() {
  const sidebarOpen        = useAppStore((s) => s.sidebarOpen);
  const citationPanelOpen  = useAppStore((s) => s.citationPanelOpen);
  const toggleSidebar      = useAppStore((s) => s.toggleSidebar);
  const toggleCitationPanel = useAppStore((s) => s.toggleCitationPanel);
  const clearChat          = useAppStore((s) => s.clearChat);
  const settings           = useAppStore((s) => s.settings);
  const updateSettings     = useAppStore((s) => s.updateSettings);
  const health             = useAppStore((s) => s.health);
  const healthLoading      = useAppStore((s) => s.healthLoading);
  const fetchHealth        = useAppStore((s) => s.fetchHealth);
  const messages           = useAppStore((s) => s.messages);

  /* Poll health on mount + every 30s */
  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 30_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const healthStatus = healthLoading ? "loading" : (health?.status ?? "unknown");

  const modelName = health?.pinecone?.index
    ? `pinecone · ${health.pinecone.index}`
    : "gemini-1.5-pro";

  return (
    <header className="topbar" role="banner">
      {/* ── Left ──────────────────────────────────── */}
      <div className="topbar__left">
        <button
          className={`icon-btn ${sidebarOpen ? "active" : ""}`}
          onClick={toggleSidebar}
          aria-label="Toggle document sidebar"
          title="Toggle sidebar"
        >
          <PanelLeft size={16} />
        </button>

        <div className="topbar__divider" />

        <span className="topbar__title">
          RAG
          <span style={{ color: "var(--text-accent)", marginLeft: 1 }}>.</span>
          intelligence
        </span>

        {settings.namespace && (
          <>
            <ChevronRight size={12} style={{ color: "var(--text-tertiary)" }} />
            <span className="namespace-pill">{settings.namespace}</span>
          </>
        )}
      </div>

      {/* ── Right ─────────────────────────────────── */}
      <div className="topbar__right">

        {/* Health indicator */}
        <button
          className="model-badge"
          onClick={fetchHealth}
          title={`Backend: ${healthStatus}`}
          style={{ cursor: "pointer" }}
        >
          <span className={`status-dot status-dot--${healthStatus}`} />
          <span>{modelName}</span>
        </button>

        <div className="topbar__divider" />

        {/* Stream toggle */}
        <button
          className={`icon-btn ${settings.streamEnabled ? "active" : ""}`}
          onClick={() => updateSettings({ streamEnabled: !settings.streamEnabled })}
          aria-label={settings.streamEnabled ? "Disable streaming" : "Enable streaming"}
          title={settings.streamEnabled ? "Streaming on" : "Streaming off"}
        >
          {settings.streamEnabled ? <Zap size={15} /> : <ZapOff size={15} />}
        </button>

        {/* Clear chat */}
        {messages.length > 0 && (
          <button
            className="icon-btn"
            onClick={clearChat}
            aria-label="Clear conversation"
            title="Clear chat"
          >
            <Trash2 size={15} />
          </button>
        )}

        {/* Citations panel toggle */}
        <button
          className={`icon-btn ${citationPanelOpen ? "active" : ""}`}
          onClick={toggleCitationPanel}
          aria-label="Toggle citations panel"
          title="Citations panel"
        >
          <BookOpen size={15} />
        </button>
      </div>
    </header>
  );
}
