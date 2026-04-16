/**
 * hooks/useChat.js
 * -----------------
 * Thin selector hook over the chat slice of appStore.
 *
 * Keeps components decoupled from the store shape — if the store changes,
 * only this hook needs updating.
 *
 * Usage:
 *   const { messages, sendQuery, isQuerying, cancelQuery, clearChat } = useChat();
 */

import { useCallback } from "react";
import { useAppStore } from "@/stores/appStore";

export function useChat() {
  const messages        = useAppStore((s) => s.messages);
  const isQuerying      = useAppStore((s) => s.isQuerying);
  const streamingId     = useAppStore((s) => s.streamingId);
  const settings        = useAppStore((s) => s.settings);
  const sendQueryStore  = useAppStore((s) => s.sendQuery);
  const cancelQuery     = useAppStore((s) => s.cancelQuery);
  const clearChat       = useAppStore((s) => s.clearChat);
  const showCitations   = useAppStore((s) => s.showCitations);

  /** Send a question through the RAG pipeline */
  const sendQuery = useCallback(
    (question) => sendQueryStore(question),
    [sendQueryStore]
  );

  /** The last assistant message (useful for auto-scroll triggers) */
  const lastMessage = messages.at(-1) ?? null;

  /** True if the most recent assistant response is still streaming */
  const isStreaming = !!streamingId;

  /**
   * Build the history array expected by POST /query/chat.
   * Returns the last N complete (non-streaming) messages.
   */
  const getHistory = useCallback(
    (n = 10) =>
      messages
        .filter((m) => !m.isStreaming && m.content)
        .slice(-n)
        .map(({ role, content }) => ({ role, content })),
    [messages]
  );

  return {
    messages,
    lastMessage,
    isQuerying,
    isStreaming,
    streamingId,
    settings,
    sendQuery,
    cancelQuery,
    clearChat,
    showCitations,
    getHistory,
  };
}
