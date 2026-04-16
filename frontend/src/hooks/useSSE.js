/**
 * hooks/useSSE.js
 * ----------------
 * Low-level hook for consuming a Server-Sent Events stream.
 *
 * This is separate from the store's _runStreamQuery so that components
 * can also open ad-hoc SSE connections (e.g. a progress feed) without
 * touching global state.
 *
 * Usage:
 *   const { start, cancel, isStreaming, tokens, sources, error } = useSSE();
 *
 *   await start({ question: "...", namespace: "default" });
 *   // tokens is updated in real-time as the stream arrives
 */

import { useState, useRef, useCallback } from "react";
import { streamQuery } from "@/services/api";

/**
 * @returns {{
 *   start:       (params: object) => Promise<void>,
 *   cancel:      () => void,
 *   isStreaming: boolean,
 *   tokens:      string,       // accumulated answer so far
 *   sources:     Source[],
 *   error:       string|null,
 *   reset:       () => void,
 * }}
 */
export function useSSE() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [tokens,      setTokens]     = useState("");
  const [sources,     setSources]    = useState([]);
  const [error,       setError]      = useState(null);

  const abortRef = useRef(null);

  const reset = useCallback(() => {
    setIsStreaming(false);
    setTokens("");
    setSources([]);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const start = useCallback(async (params) => {
    reset();

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);

    try {
      for await (const event of streamQuery({ ...params, signal: controller.signal })) {
        if (event.type === "token") {
          setTokens((prev) => prev + event.data);
        } else if (event.type === "sources") {
          setSources(event.data);
        } else if (event.type === "done") {
          break;
        } else if (event.type === "error") {
          setError(event.data);
          break;
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message ?? "Stream failed");
      }
    } finally {
      setIsStreaming(false);
    }
  }, [reset]);

  return { start, cancel, isStreaming, tokens, sources, error, reset };
}
