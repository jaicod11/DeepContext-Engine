/**
 * hooks/useDocuments.js
 * ─────────────────────────────────────────────────────────────────────────
 * Document library, now backed by the SERVER not just browser state.
 *
 * loadDocuments() hits GET /api/v1/documents and replaces the local list.
 * Called automatically on mount, which is what makes uploaded documents
 * reappear after a refresh or a fresh login.
 */

import { useCallback, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import {
  deleteDocument as apiDelete,
  fetchStats,
  listDocuments,
  uploadDocument,
} from "@/services/api";

export function useDocuments() {
  const documents = useAppStore((s) => s.documents);
  const uploadQueue = useAppStore((s) => s.uploadQueue);
  const indexStats = useAppStore((s) => s.indexStats);
  const addDocument = useAppStore((s) => s.addDocument);
  const removeDocument = useAppStore((s) => s.removeDocument);
  const setDocuments = useAppStore((s) => s.setDocuments);
  const setIndexStats = useAppStore((s) => s.setIndexStats);
  const addToQueue = useAppStore((s) => s.addToUploadQueue);
  const updateEntry = useAppStore((s) => s.updateUploadEntry);
  const clearCompleted = useAppStore((s) => s.clearCompletedUploads);
  const addToast = useAppStore((s) => s._addToast);

  const token = useAuthStore((s) => s.token);

  /** Fetch the user's persistent document library from the server. */
  const loadDocuments = useCallback(async () => {
    if (!token) return;
    try {
      const records = await listDocuments();
      setDocuments(
        records.map((r) => ({
          document_id: r.document_id,
          filename: r.filename,
          chunks_total: r.chunks_total,
          namespace: r.namespace,
          uploadedAt: new Date(r.uploaded_at).getTime(),
          status: "complete",
        }))
      );
    } catch (err) {
      // Anything axios didn't raise came from our own code inside this
      // try block — a TypeError, a bad field on `r`, a missing store
      // action. Those are bugs, not network conditions, and reporting
      // them as "could not load" hides them. Log and re-throw so they
      // surface immediately.
      if (!err?.isAxiosError) {
        console.error("[useDocuments] loadDocuments failed with a non-HTTP error:", err);
        throw err;
      }

      // Past here it's a real transport/HTTP failure. 401 is handled
      // globally by the axios interceptor (auto-logout), so only surface
      // anything else — including `err.response === undefined`, which is
      // how axios reports an unreachable server or a blocked preflight.
      if (err.response?.status !== 401) {
        addToast?.({ message: "Could not load your documents.", type: "error" });
      }
    }
  }, [token, setDocuments, addToast]);

  const refreshStats = useCallback(async () => {
    if (!token) return;
    try {
      const stats = await fetchStats();
      setIndexStats(stats);
    } catch (_) { /* non-critical */ }
  }, [token, setIndexStats]);

  /** Load library + stats whenever we have a token. */
  useEffect(() => {
    if (token) {
      loadDocuments();
      refreshStats();
    }
  }, [token, loadDocuments, refreshStats]);

  const uploadFile = useCallback(async (file) => {
    const entryId = addToQueue(file);
    updateEntry(entryId, { status: "uploading", progress: 0 });

    try {
      const result = await uploadDocument(file, null, (pct) =>
        updateEntry(entryId, { progress: pct })
      );

      updateEntry(entryId, { status: "complete", progress: 100 });

      addDocument({
        document_id: result.document_id,
        filename: result.filename,
        chunks_total: result.chunks_total,
        namespace: result.namespace,
        uploadedAt: Date.now(),
        status: "complete",
      });

      addToast?.({ message: `${file.name} indexed successfully.`, type: "success" });
      refreshStats();
      return result;
    } catch (err) {
      const detail =
        err?.response?.data?.detail || err?.message || "Upload failed.";
      updateEntry(entryId, { status: "error", error: detail });
      addToast?.({ message: `${file.name}: ${detail}`, type: "error" });
      throw err;
    }
  }, [addToQueue, updateEntry, addDocument, addToast, refreshStats]);

  const uploadFiles = useCallback(async (files) => {
    for (const file of files) {
      try {
        await uploadFile(file);
      } catch (_) { /* already surfaced per-file */ }
    }
  }, [uploadFile]);

  const deleteDoc = useCallback(async (documentId) => {
    try {
      await apiDelete(documentId);
      removeDocument(documentId);
      addToast?.({ message: "Document deleted.", type: "success" });
      refreshStats();
    } catch (err) {
      const detail =
        err?.response?.data?.detail || err?.message || "Delete failed.";
      addToast?.({ message: detail, type: "error" });
    }
  }, [removeDocument, addToast, refreshStats]);

  return {
    documents,
    uploadQueue,
    indexStats,
    uploadFile,
    uploadFiles,
    deleteDoc,
    loadDocuments,
    refreshStats,
    clearCompleted,
  };
}