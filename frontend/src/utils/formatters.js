/**
 * utils/formatters.js
 * --------------------
 * Display formatting helpers.
 */

/**
 * Format pipeline latency for display.
 *
 * @param {number} ms
 * @returns {string}  e.g. "312ms" | "1.4s"
 */
export function formatLatency(ms) {
  if (ms == null) return "—";
  if (ms < 1000)  return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a file size in bytes to a human-readable string.
 *
 * @param {number} bytes
 * @returns {string}  e.g. "4.2 KB" | "1.8 MB"
 */
export function formatBytes(bytes) {
  if (bytes === 0)        return "0 B";
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1_048_576)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Format a Unix timestamp as a relative time string.
 *
 * @param {number} ts   Unix ms timestamp
 * @returns {string}    e.g. "just now" | "3 min ago" | "2 hr ago"
 */
export function formatRelativeTime(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)          return "just now";
  if (diff < 3600)        return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)       return `${Math.floor(diff / 3600)} hr ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Clamp a string to a max character count with an ellipsis.
 *
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
export function truncate(str, max = 120) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max).trimEnd() + "…";
}
