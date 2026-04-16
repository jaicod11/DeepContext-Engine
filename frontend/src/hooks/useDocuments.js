/**
 * hooks/useDocuments.js
 * ----------------------
 * Document management hook — wraps the documents slice of appStore
 * and handles the async upload/delete lifecycle.
 *
 * Usage:
 *   const {
 *     documents, uploadQueue, indexStats,
 *     uploadFile, deleteDoc, refreshStats,
 *   } = useDocuments();
 */

import { useCallback } from "react";
import { useAppStore } from "@/stores/appStore";
import {
  uploadDocument,
  deleteDocument,
  fetchIndexStats,
} from "@/services/api";

export function useDocuments() {
  const documents          = useAppStore((s) => s.documents);
  const uploadQueue        = useAppStore((s) => s.uploadQueue);
  const indexStats         = useAppStore((s) => s.indexStats);
  const addDocument        = useAppStore((s) => s.addDocument);
  const removeDocument     = useAppStore((s) => s.removeDocument);
  const addToUploadQueue   = useAppStore((s) => s.addToUploadQueue);
  const updateUploadEntry  = useAppStore((s) => s.updateUploadEntry);
  const clearCompleted     = useAppStore((s) => s.clearCompletedUploads);
  const setIndexStats      = useAppStore((s) => s.setIndexStats);
  const _addToast          = useAppStore((s) => s._addToast);
  const settings           = useAppStore((s) => s.settings);

  /**
   * Upload a File object to the backend.
   * Tracks progress in the upload queue and adds the result to documents.
   *
   * @param {File}   file
   * @param {string} [namespaceOverride]
   */
  const uploadFile = useCallback(
    async (file, namespaceOverride) => {
      const ns      = namespaceOverride ?? settings.namespace ?? null;
      const queueId = addToUploadQueue(file);

      updateUploadEntry(queueId, { status: "uploading" });

      try {
        const result = await uploadDocument(
          file,
          ns,
          (progress) => updateUploadEntry(queueId, { progress })
        );

        updateUploadEntry(queueId, { status: "complete", progress: 100 });

        addDocument({
          ...result,
          uploadedAt: Date.now(),
        });

        _addToast({
          message: `"${result.filename}" ingested — ${result.chunks_total} chunks`,
          type:    "success",
        });

        // Refresh index stats after successful ingest
        refreshStats();

        return result;
      } catch (err) {
        const msg = err?.message ?? "Upload failed";
        updateUploadEntry(queueId, { status: "error", error: msg });
        _addToast({ message: msg, type: "error" });
        throw err;
      }
    },
    [settings.namespace, addToUploadQueue, updateUploadEntry, addDocument, _addToast]
  );

  /**
   * Upload multiple files sequentially.
   * @param {File[]} files
   */
  const uploadFiles = useCallback(
    async (files, namespaceOverride) => {
      for (const file of files) {
        try {
          await uploadFile(file, namespaceOverride);
        } catch (_) {
          // Individual errors already toasted; continue with remaining files
        }
      }
    },
    [uploadFile]
  );

  /**
   * Delete a document and all its Pinecone chunks.
   * @param {string} documentId
   * @param {string} [namespace]
   */
  const deleteDoc = useCallback(
    async (documentId, namespace) => {
      const ns = namespace ?? settings.namespace ?? null;
      try {
        await deleteDocument(documentId, ns);
        removeDocument(documentId);
        _addToast({ message: "Document deleted", type: "success" });
        refreshStats();
      } catch (err) {
        _addToast({ message: err?.message ?? "Delete failed", type: "error" });
      }
    },
    [settings.namespace, removeDocument, _addToast]
  );

  /** Fetch and cache Pinecone index stats */
  const refreshStats = useCallback(async () => {
    try {
      const stats = await fetchIndexStats();
      setIndexStats(stats);
    } catch (_) {
      // Non-critical — fail silently
    }
  }, [setIndexStats]);

  return {
    documents,
    uploadQueue,
    indexStats,
    uploadFile,
    uploadFiles,
    deleteDoc,
    refreshStats,
    clearCompleted,
  };
}
