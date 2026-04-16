/**
 * utils/parseSources.js
 * ----------------------
 * Utilities for working with [SOURCE N] citations in LLM answers.
 */

/**
 * Extract all [SOURCE N] references from an answer string.
 *
 * @param {string} text
 * @returns {number[]}  Sorted unique list of source indices (1-based)
 *
 * @example
 *   extractSourceIndices("Payment is due in 30 days [SOURCE 1][SOURCE 3].")
 *   // → [1, 3]
 */
export function extractSourceIndices(text) {
  const matches = [...text.matchAll(/\[SOURCE\s+(\d+)\]/gi)];
  const indices = matches.map((m) => parseInt(m[1], 10));
  return [...new Set(indices)].sort((a, b) => a - b);
}

/**
 * Replace [SOURCE N] tags in text with styled inline HTML spans
 * (used for rendering in MessageBubble).
 *
 * @param {string} text
 * @returns {string}  Text with [SOURCE N] replaced by <cite> elements
 */
export function injectCitationMarkup(text) {
  return text.replace(
    /\[SOURCE\s+(\d+)\]/gi,
    (_, n) =>
      `<cite class="citation-tag" data-source="${n}">[${n}]</cite>`
  );
}

/**
 * Filter a sources array to only those referenced in the answer text.
 *
 * @param {string}   text
 * @param {Source[]} sources
 * @returns {Source[]}
 */
export function filterReferencedSources(text, sources) {
  const indices = new Set(extractSourceIndices(text));
  return sources.filter((s) => indices.has(s.index));
}

/**
 * Format a similarity score as a percentage label.
 *
 * @param {number} score   0.0–1.0
 * @returns {string}       e.g. "93%"
 */
export function formatScore(score) {
  return `${Math.round(score * 100)}%`;
}
