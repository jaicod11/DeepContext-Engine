/**
 * components/chat/QueryInput.jsx
 * --------------------------------
 * The query input bar at the bottom of the chat.
 *
 * Features:
 *   • Auto-growing textarea (1–6 lines)
 *   • Enter to send, Shift+Enter for newline
 *   • Cancel button during active stream
 *   • Disabled state while querying
 *   • Character counter when approaching limit
 *   • topK / topN quick-override popover
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, SlidersHorizontal, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useChat }     from "@/hooks/useChat";

const MAX_CHARS = 2000;

/* ── Settings popover ─────────────────────────────────────────────── */
function SettingsPopover({ onClose }) {
  const settings       = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [topK, setTopK] = useState(settings.topK ?? "");
  const [topN, setTopN] = useState(settings.topN ?? "");

  const save = () => {
    updateSettings({
      topK: topK !== "" ? parseInt(topK, 10) : null,
      topN: topN !== "" ? parseInt(topN, 10) : null,
    });
    onClose();
  };

  return (
    <div style={{
      position:     "absolute",
      bottom:       "calc(100% + 8px)",
      right:        0,
      width:        220,
      background:   "var(--bg-elevated)",
      border:       "1px solid var(--bg-border)",
      borderRadius: "var(--radius-lg)",
      padding:      "12px 14px",
      boxShadow:    "0 8px 32px rgba(0,0,0,0.4)",
      zIndex:       50,
    }}>
      <div style={{
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        marginBottom:   10,
      }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
          QUERY SETTINGS
        </span>
        <button onClick={onClose} style={{ color: "var(--text-tertiary)" }}>
          <X size={13} />
        </button>
      </div>

      {[
        { label: "Candidates (top_k)", value: topK, set: setTopK, placeholder: "20", min: 1, max: 100 },
        { label: "Final chunks (top_n)", value: topN, set: setTopN, placeholder: "5",  min: 1, max: 20  },
      ].map(({ label, value, set, placeholder, min, max }) => (
        <div key={label} style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
            {label}
          </label>
          <input
            className="input"
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => set(e.target.value)}
            placeholder={placeholder}
            style={{ fontSize: 12 }}
          />
        </div>
      ))}

      <button className="btn btn-primary" onClick={save} style={{ width: "100%", justifyContent: "center", fontSize: 11 }}>
        Apply
      </button>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */
export default function QueryInput() {
  const { isQuerying, sendQuery, cancelQuery } = useChat();
  const settings = useAppStore((s) => s.settings);

  const [value,   setValue]   = useState("");
  const [popover, setPopover] = useState(false);
  const textareaRef = useRef(null);
  const wrapperRef  = useRef(null);

  /* Auto-resize textarea */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineH  = 20;
    const maxH   = lineH * 6 + 24;
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }, [value]);

  /* Close popover on outside click */
  useEffect(() => {
    if (!popover) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setPopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popover]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [value, isQuerying]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isQuerying) return;
    sendQuery(trimmed);
    setValue("");
    textareaRef.current?.focus();
  }, [value, isQuerying, sendQuery]);

  const charsLeft    = MAX_CHARS - value.length;
  const nearLimit    = charsLeft < 200;
  const overLimit    = charsLeft < 0;
  const canSend      = value.trim().length >= 3 && !overLimit && !isQuerying;

  return (
    <div style={{
      padding:       "12px 20px 16px",
      borderTop:     "1px solid var(--bg-border)",
      background:    "var(--bg-base)",
      flexShrink:    0,
    }}>
      {/* Input row */}
      <div
        ref={wrapperRef}
        style={{
          display:      "flex",
          alignItems:   "flex-end",
          gap:          8,
          background:   "var(--bg-input)",
          border:       `1px solid ${isQuerying ? "var(--accent-dim)" : "var(--bg-border)"}`,
          borderRadius: "var(--radius-lg)",
          padding:      "10px 10px 10px 14px",
          transition:   "border-color 200ms, box-shadow 200ms",
          boxShadow:    isQuerying ? "0 0 0 2px var(--accent-glow)" : "none",
          position:     "relative",
        }}
        onFocus={() => {}}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isQuerying ? "Generating…" : "Ask anything about your documents…"}
          disabled={isQuerying}
          maxLength={MAX_CHARS + 50}
          rows={1}
          style={{
            flex:       1,
            resize:     "none",
            background: "transparent",
            border:     "none",
            outline:    "none",
            color:      isQuerying ? "var(--text-tertiary)" : "var(--text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize:   13,
            lineHeight: "20px",
            padding:    0,
            overflow:   "hidden",
          }}
        />

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {/* Settings popover trigger */}
          <div style={{ position: "relative" }}>
            <button
              className={`icon-btn ${popover ? "active" : ""}`}
              onClick={() => setPopover((v) => !v)}
              title="Query settings"
              style={{ width: 28, height: 28 }}
            >
              <SlidersHorizontal size={13} />
            </button>
            {popover && <SettingsPopover onClose={() => setPopover(false)} />}
          </div>

          {/* Send / Cancel */}
          {isQuerying ? (
            <button
              onClick={cancelQuery}
              title="Cancel generation"
              style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                width:          32,
                height:         32,
                borderRadius:   "var(--radius-md)",
                background:     "rgba(255,107,107,0.12)",
                border:         "1px solid rgba(255,107,107,0.3)",
                color:          "var(--text-error)",
              }}
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              title="Send (Enter)"
              style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                width:          32,
                height:         32,
                borderRadius:   "var(--radius-md)",
                background:     canSend ? "var(--accent)"         : "var(--bg-elevated)",
                color:          canSend ? "#09090B"               : "var(--text-tertiary)",
                border:         "none",
                cursor:         canSend ? "pointer"               : "not-allowed",
                transition:     "background 150ms, color 150ms, box-shadow 150ms",
                boxShadow:      canSend ? "0 0 12px var(--accent-glow)" : "none",
              }}
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Footer row */}
      <div style={{
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        marginTop:      6,
        paddingLeft:    2,
      }}>
        <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {settings.streamEnabled ? "⚡ streaming" : "blocking"} ·{" "}
          {settings.namespace || "default"} ns
          {(settings.topK || settings.topN) && ` · k=${settings.topK ?? "auto"} n=${settings.topN ?? "auto"}`}
        </span>
        {nearLimit && (
          <span style={{
            fontSize:   10,
            fontFamily: "var(--font-mono)",
            color:      overLimit ? "var(--text-error)" : "var(--text-warning)",
          }}>
            {overLimit ? `${-charsLeft} over limit` : `${charsLeft} left`}
          </span>
        )}
        {!nearLimit && (
          <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            Enter to send · Shift+Enter for newline
          </span>
        )}
      </div>
    </div>
  );
}
