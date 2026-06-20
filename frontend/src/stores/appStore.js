import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { queryRAG, streamQuery, fetchHealth } from "@/services/api";

// ─────────────────────────────────────────────
// Types / shapes (JSDoc)
// ─────────────────────────────────────────────
/**
 * @typedef {{ role: "user"|"assistant", content: string, sources?: Source[], latency_ms?: number, model?: string, id: string }} Message
 * @typedef {{ index: number, source: string, score: number, text_preview: string, vector_id: string }} Source
 * @typedef {{ id: string, filename: string, document_id: string, chunks_total: number, namespace: string, status: string, uploadedAt: number }} DocRecord
 * @typedef {{ message: string, type: "success"|"error"|"info", id: string }} Toast
 */

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const uid = () => crypto.randomUUID();

const makeMessage = (role, content, extras = {}) => ({
  id: uid(),
  role,
  content,
  sources: [],
  latency_ms: null,
  model: null,
  isStreaming: false,
  error: null,
  ...extras,
});

// ─────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────

export const useAppStore = create(
  devtools(
    persist(
      (set, get) => ({

        // ══════════════════════════════════════
        // CHAT SLICE
        // ══════════════════════════════════════

        messages: [],
        isQuerying: false,
        streamingId: null,    // ID of the message currently being streamed
        abortController: null,    // AbortController for the active stream

        /** Append a user message + fire the RAG query */
        sendQuery: async (question) => {
          const { settings, _appendMessage, _updateMessage, _addToast } = get();

          if (!question.trim() || get().isQuerying) return;

          // 1. Add user bubble
          const userMsg = makeMessage("user", question);
          _appendMessage(userMsg);

          // 2. Add placeholder assistant bubble
          const assistantMsg = makeMessage("assistant", "", { isStreaming: true });
          _appendMessage(assistantMsg);

          set({ isQuerying: true, streamingId: assistantMsg.id });

          const queryParams = {
            question,
            namespace: settings.namespace || null,
            topK: settings.topK || null,
            topN: settings.topN || null,
            metadataFilter: settings.metadataFilter || null,
          };

          // 3. History for conversational mode (last 6 messages, excluding placeholder)
          const history = get().messages
            .filter((m) => !m.isStreaming && m.content)
            .slice(-6)
            .map(({ role, content }) => ({ role, content }));

          try {
            if (settings.streamEnabled) {
              await get()._runStreamQuery(assistantMsg.id, queryParams);
            } else {
              // ── Blocking mode ──────────────────
              const result = await queryRAG(queryParams);
              _updateMessage(assistantMsg.id, {
                content: result.answer,
                sources: result.sources,
                latency_ms: result.latency_ms,
                model: result.model,
                isStreaming: false,
              });
            }
          } catch (err) {
            const message = err?.message ?? "Query failed. Check your connection.";
            _updateMessage(assistantMsg.id, {
              content: "",
              error: message,
              isStreaming: false,
            });
            _addToast({ message, type: "error" });
          } finally {
            set({ isQuerying: false, streamingId: null, abortController: null });
          }
        },

        /** Internal: run SSE stream and patch the assistant message token-by-token */
        _runStreamQuery: async (messageId, queryParams) => {
          const { _updateMessage, _patchStreamContent } = get();
          const controller = new AbortController();
          set({ abortController: controller });

          for await (const event of streamQuery({
            ...queryParams,
            signal: controller.signal,
          })) {
            if (event.type === "token") {
              _patchStreamContent(messageId, event.data);
            } else if (event.type === "sources") {
              _updateMessage(messageId, { sources: event.data });
            } else if (event.type === "done") {
              _updateMessage(messageId, { isStreaming: false });
              break;
            } else if (event.type === "error") {
              _updateMessage(messageId, {
                error: event.data,
                isStreaming: false,
              });
              break;
            }
          }
        },

        /** Cancel an in-progress stream */
        cancelQuery: () => {
          const { abortController } = get();
          abortController?.abort();
          const { streamingId, _updateMessage } = get();
          if (streamingId) {
            _updateMessage(streamingId, { isStreaming: false });
          }
          set({ isQuerying: false, streamingId: null, abortController: null });
        },

        /** Clear entire conversation */
        clearChat: () => set({ messages: [], streamingId: null }),

        /** Internal helpers */
        _appendMessage: (msg) =>
          set((s) => ({ messages: [...s.messages, msg] })),

        _updateMessage: (id, patch) =>
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === id ? { ...m, ...patch } : m
            ),
          })),

        _patchStreamContent: (id, token) =>
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === id ? { ...m, content: m.content + token } : m
            ),
          })),


        // ══════════════════════════════════════
        // DOCUMENTS SLICE
        // ══════════════════════════════════════

        documents: [],   // DocRecord[]
        uploadQueue: [],   // { file, status, progress, error, id }[]
        indexStats: null,

        addDocument: (doc) =>
          set((s) => ({ documents: [doc, ...s.documents] })),

        removeDocument: (documentId) =>
          set((s) => ({
            documents: s.documents.filter((d) => d.document_id !== documentId),
          })),

        addToUploadQueue: (file) => {
          const entry = { id: uid(), file, status: "pending", progress: 0, error: null };
          set((s) => ({ uploadQueue: [...s.uploadQueue, entry] }));
          return entry.id;
        },

        updateUploadEntry: (id, patch) =>
          set((s) => ({
            uploadQueue: s.uploadQueue.map((e) =>
              e.id === id ? { ...e, ...patch } : e
            ),
          })),

        clearCompletedUploads: () =>
          set((s) => ({
            uploadQueue: s.uploadQueue.filter((e) => e.status === "pending"),
          })),

        setIndexStats: (stats) => set({ indexStats: stats }),


        // ══════════════════════════════════════
        // CHAT HISTORY SLICE
        // ══════════════════════════════════════

        chatSessions: {},   // { [documentId]: { documentId, filename, messages, updatedAt } }

        saveChatSession: (documentId, filename, messages) =>
          set((s) => ({
            chatSessions: {
              ...s.chatSessions,
              [documentId]: { documentId, filename, messages, updatedAt: Date.now() },
            },
          })),


        // ══════════════════════════════════════
        // DOCUMENT INSIGHTS SLICE
        // ══════════════════════════════════════

        docInsights: {},   // { [documentId]: { summary, sources, generatedAt } }

        saveDocInsight: (documentId, insight) =>
          set((s) => ({
            docInsights: { ...s.docInsights, [documentId]: insight },
          })),


        // ══════════════════════════════════════
        // SETTINGS SLICE  (persisted)
        // ══════════════════════════════════════

        settings: {
          streamEnabled: true,
          namespace: "",
          topK: null,
          topN: null,
          metadataFilter: null,
        },

        updateSettings: (patch) =>
          set((s) => ({ settings: { ...s.settings, ...patch } })),


        // ══════════════════════════════════════
        // UI SLICE
        // ══════════════════════════════════════

        sidebarOpen: true,
        showUploadModal: false,
        openUploadModal: () => set({ showUploadModal: true }),
        setShowUploadModal: (val) => set({ showUploadModal: val }),
        citationPanelOpen: false,
        activeCitations: [],      // sources for the currently selected message
        toasts: [],
        health: null,    // { status, version, pinecone }
        healthLoading: false,

        toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
        toggleCitationPanel: () => set((s) => ({ citationPanelOpen: !s.citationPanelOpen })),

        showCitations: (sources) =>
          set({ activeCitations: sources, citationPanelOpen: true }),

        hideCitations: () =>
          set({ citationPanelOpen: false, activeCitations: [] }),

        _addToast: ({ message, type = "info" }) => {
          const id = uid();
          set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
          setTimeout(
            () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
            4500
          );
        },

        dismissToast: (id) =>
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

        fetchHealth: async () => {
          set({ healthLoading: true });
          try {
            const data = await fetchHealth();
            set({ health: data, healthLoading: false });
          } catch (_) {
            set({
              health: { status: "error", version: "—", pinecone: {} },
              healthLoading: false,
            });
          }
        },
      }),

      {
        name: "rag-app-store",
        // Only persist settings — chat and documents are session-only
        partialize: (s) => ({ settings: s.settings, chatSessions: s.chatSessions, docInsights: s.docInsights }),
      }
    ),
    { name: "RAG App" }
  )
);
