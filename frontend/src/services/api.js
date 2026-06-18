import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 60_000,          // 60s — LLM calls can be slow
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  },
});

// ── Request interceptor — inject request ID for tracing ──────────────────────
client.interceptors.request.use((config) => {
  config.headers["X-Request-ID"] = crypto.randomUUID();
  return config;
});

// ── Response interceptor — normalise errors ───────────────────────────────────
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const detail = error.response?.data?.detail ?? error.message ?? "Unknown error";
    const reqId = error.response?.headers?.["x-request-id"] ?? null;

    const normalised = {
      status,
      message: detail,
      requestId: reqId,
      isNetworkError: !error.response,
      isAuthError: status === 401 || status === 403,
      isRateLimit: status === 429,
      retryAfter: error.response?.headers?.["retry-after"] ?? null,
    };

    return Promise.reject(normalised);
  }
);


// ─────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────

/**
 * GET /health
 * @returns {{ status: string, version: string, pinecone: object }}
 */
export const fetchHealth = async () => {
  const baseRoot = BASE_URL.replace(/\/api\/v1$/, "");
  const { data } = await axios.get(`${baseRoot}/health`);
  return data;
};


// ─────────────────────────────────────────────
// Query — blocking (JSON response)
// ─────────────────────────────────────────────

/**
 * POST /query
 *
 * @param {object} params
 * @param {string}  params.question
 * @param {string}  [params.namespace]
 * @param {object}  [params.metadataFilter]
 * @param {number}  [params.topK]
 * @param {number}  [params.topN]
 *
 * @returns {{
 *   answer: string,
 *   sources: Array<{ index, source, score, text_preview, vector_id }>,
 *   query: string,
 *   total_candidates: number,
 *   reranked: boolean,
 *   latency_ms: number,
 *   model: string,
 * }}
 */
export const queryRAG = async ({
  question,
  namespace = null,
  metadataFilter = null,
  topK = null,
  topN = null,
}) => {
  const { data } = await client.post("/query", {
    question,
    namespace,
    metadata_filter: metadataFilter,
    top_k: topK,
    top_n: topN,
    stream: false,
  });
  return data;
};


// ─────────────────────────────────────────────
// Query — streaming (SSE via native fetch)
// ─────────────────────────────────────────────

/**
 * POST /query  (stream: true)
 *
 * Uses the native fetch API — Axios does not support SSE streaming.
 * Returns an async generator that yields parsed SSE events:
 *
 *   { type: "token",   data: string }
 *   { type: "sources", data: Source[] }
 *   { type: "done" }
 *   { type: "error",   data: string }
 *
 * Usage:
 *   for await (const event of streamQuery({ question: "..." })) {
 *     if (event.type === "token") appendToken(event.data);
 *   }
 */
export async function* streamQuery({
  question,
  namespace = null,
  metadataFilter = null,
  topK = null,
  topN = null,
  signal = null,   // AbortController signal for cancellation
}) {
  const url = `${BASE_URL}/query`;
  const body = JSON.stringify({
    question,
    namespace,
    metadata_filter: metadataFilter,
    top_k: topK,
    top_n: topN,
    stream: true,
  });

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
        "X-Request-ID": crypto.randomUUID(),
      },
      body,
      signal,
    });
  } catch (err) {
    yield { type: "error", data: err.message };
    return;
  }

  if (!response.ok) {
    let detail = "Stream request failed";
    try { detail = (await response.json()).detail ?? detail; } catch (_) { }
    yield { type: "error", data: detail };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";          // keep incomplete last line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);     // strip "data: "

      if (payload === "[DONE]") {
        yield { type: "done" };
        return;
      }

      if (payload.startsWith("[SOURCES] ")) {
        try {
          const sources = JSON.parse(payload.slice(10));
          yield { type: "sources", data: sources };
        } catch (_) { }
        continue;
      }

      if (payload.startsWith("[ERROR] ")) {
        yield { type: "error", data: payload.slice(8) };
        return;
      }

      yield { type: "token", data: payload };
    }
  }
}


// ─────────────────────────────────────────────
// Conversational query
// ─────────────────────────────────────────────

/**
 * POST /query/chat
 *
 * @param {object} params
 * @param {string}  params.question
 * @param {Array<{ role: string, content: string }>} params.history
 * @param {string}  [params.namespace]
 */
export const queryConversational = async ({ question, history = [], namespace = null }) => {
  const { data } = await client.post("/query/chat", {
    question,
    history,
    namespace,
  });
  return data;
};


// ─────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────

/**
 * POST /documents/upload  (multipart)
 *
 * @param {File}   file
 * @param {string} [namespace]
 * @param {Function} [onProgress]  — (percent: number) => void
 *
 * @returns {IngestResponse}
 */
export const uploadDocument = async (file, namespace = null, onProgress = null) => {
  const form = new FormData();
  form.append("file", file);
  if (namespace) form.append("namespace", namespace);

  const { data } = await client.post("/documents/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: onProgress
      ? (e) => onProgress(Math.round((e.loaded / e.total) * 100))
      : undefined,
  });
  return data;
};


/**
 * POST /documents/text
 *
 * @param {{ text: string, source?: string, namespace?: string, metadata?: object }} params
 * @returns {IngestResponse}
 */
export const ingestText = async ({ text, source = "inline", namespace = null, metadata = null }) => {
  const { data } = await client.post("/documents/text", {
    text,
    source,
    namespace,
    metadata,
  });
  return data;
};


/**
 * DELETE /documents/{documentId}
 *
 * @param {string} documentId
 * @param {string} [namespace]
 */
export const deleteDocument = async (documentId, namespace = null) => {
  await client.delete(`/documents/${documentId}`, {
    params: namespace ? { namespace } : {},
  });
};


/**
 * GET /documents/stats
 *
 * @returns {{ total_vectors, dimension, namespaces, index_fullness }}
 */
export const fetchIndexStats = async () => {
  const { data } = await client.get("/documents/stats");
  return data;
};


// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

export default client;
