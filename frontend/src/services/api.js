/**
 * services/api.js
 * ─────────────────────────────────────────────────────────────────────────
 * Axios client + SSE streaming client.
 *
 * AUTH: every request carries `Authorization: Bearer <jwt>` pulled live
 * from authStore. The old X-API-Key header is gone — the backend now
 * authenticates users individually, not via one shared secret.
 *
 * A 401 response anywhere triggers an automatic logout, so an expired
 * token drops you cleanly to the login screen instead of leaving the UI
 * silently broken.
 */

import axios from "axios";
import { getAuthToken, useAuthStore } from "@/stores/authStore";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

export const client = axios.create({
  baseURL: BASE_URL,
  timeout: 90_000,          // 90s — LLM calls + retrieval can be slow
  headers: { "Content-Type": "application/json" },
});

// ── Attach JWT to every outgoing request ────────────────────────────────
client.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auto-logout on 401 ──────────────────────────────────────────────────
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

// ─────────────────────────────────────────────
// Health (lives outside /api/v1)
// ─────────────────────────────────────────────

export const fetchHealth = async () => {
  const baseRoot = BASE_URL.replace(/\/api\/v1$/, "");
  const { data } = await axios.get(`${baseRoot}/health`);
  return data;
};

// ─────────────────────────────────────────────
// Account
// ─────────────────────────────────────────────

/**
 * Update the signed-in user's profile. Only full_name is editable — the
 * backend takes the user from the JWT and ignores any id/email in the body.
 * Returns the updated UserResponse.
 */
export const updateProfile = async ({ fullName }) => {
  const { data } = await client.patch("/auth/me", { full_name: fullName });
  return data;
};

// ─────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────

/**
 * List the current user's documents.
 * THIS is what makes uploads persist across refreshes — the library
 * lives server-side now, not just in browser state.
 */
export const listDocuments = async () => {
  const { data } = await client.get("/documents");
  return data;   // [{ document_id, filename, chunks_total, namespace, uploaded_at }]
};

export const uploadDocument = async (file, _namespace = null, onProgress = null) => {
  const form = new FormData();
  form.append("file", file);
  // NOTE: namespace is no longer sent — the backend derives it from the
  // authenticated user. Passing one would be ignored.

  const UPLOAD_TIMEOUT = 5 * 60 * 1000;   // 5 minutes for large files

  const { data } = await client.post("/documents/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: UPLOAD_TIMEOUT,
    onUploadProgress: onProgress
      ? (e) => onProgress(Math.round((e.loaded / e.total) * 100))
      : undefined,
  });
  return data;
};

export const deleteDocument = async (documentId) => {
  await client.delete(`/documents/${documentId}`);
};

export const fetchStats = async () => {
  const { data } = await client.get("/documents/stats");
  return data;
};

// ─────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────

export const queryRAG = async ({
  question,
  metadataFilter = null,
  topK = null,
  topN = null,
}) => {
  const { data } = await client.post("/query", {
    question,
    metadata_filter: metadataFilter,
    top_k: topK,
    top_n: topN,
    stream: false,
  });
  return data;
};

/**
 * SSE streaming query.
 * Uses fetch (not axios) because axios can't stream response bodies
 * in the browser.
 *
 * Yields: { type: "token"|"sources"|"done"|"error", data }
 */
export async function* streamQuery({
  question,
  metadataFilter = null,
  topK = null,
  topN = null,
  signal = null,
}) {
  const token = getAuthToken();

  let res;
  try {
    res = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        question,
        metadata_filter: metadataFilter,
        top_k: topK,
        top_n: topN,
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    yield { type: "error", data: err.message };
    return;
  }

  if (res.status === 401) {
    useAuthStore.getState().logout();
    yield { type: "error", data: "Session expired. Please sign in again." };
    return;
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body?.detail || detail;
    } catch (_) { /* non-JSON error body */ }
    yield { type: "error", data: detail };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);

      if (payload === "[DONE]") {
        yield { type: "done" };
        return;
      }

      if (payload.startsWith("[SOURCES] ")) {
        try {
          const sources = JSON.parse(payload.slice(10));
          yield { type: "sources", data: sources };
        } catch (_) { /* malformed sources frame */ }
        continue;
      }

      if (payload.startsWith("[ERROR] ")) {
        yield { type: "error", data: payload.slice(8) };
        continue;
      }

      yield { type: "token", data: payload };
    }
  }

  yield { type: "done" };
}