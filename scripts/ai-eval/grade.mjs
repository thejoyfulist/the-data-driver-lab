/**
 * Grading of one answer against the frozen truth.
 *
 *   exact               every expected value is in the answer, nothing forbidden
 *   correct_refusal     an unanswerable question answered "not available"
 *   unnecessary_refusal an answerable question refused (a failure, not a lie)
 *   wrong               a missing or contradicting value, or a made-up answer
 *   error               the provider or endpoint failed; no answer to grade
 *
 * A run passes only with zero "wrong": one false answer fails it.
 */

const REFUSAL_PATTERNS = [
  /\bnot available\b/,
  /\bis(?: not|n t) (?:published|available)\b/,
  /\bhas(?: not|n t) been published\b/,
  /\bno (?:published )?data\b/,
  /\bunavailable\b/,
  /\bcannot (?:find|answer)\b/,
  /\bcan t (?:find|answer)\b/,
  /\bdo(?:es)? not (?:have|include|contain)\b/,
  /\bdon t have\b/,
  /\bnot (?:yet )?(?:been )?(?:held|run)\b/,
  /\bcancelled\b/,
];

export function normaliseAnswer(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the answer contains `needle` as a whole token run (so "5" does not match "15"). */
export function containsValue(answer, needle) {
  const hay = normaliseAnswer(answer);
  const value = normaliseAnswer(needle);
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9.])${escaped}(?![0-9]|\\.[0-9])(?![a-z])`).test(hay) ||
    // A number may be followed by letters ("25pts", "2nd"): accept a digit boundary for numeric needles.
    (/^\d+(\.\d+)?$/.test(value) && new RegExp(`(^|[^0-9.])${escaped}(?![0-9]|\\.[0-9])`).test(hay));
}

export function isRefusal(answer) {
  const text = normaliseAnswer(answer);
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * @param {{ kind: "answer" | "refusal", expect: Array<string | string[]>, forbid?: string[] }} item
 * @param {string | null} answer
 * @returns {{ grade: string, missing: string[], forbidden: string[] }}
 */
export function gradeAnswer(item, answer) {
  if (answer == null) return { grade: "error", missing: [], forbidden: [] };
  const forbidden = (item.forbid ?? []).filter((value) => containsValue(answer, value));
  if (item.kind === "refusal") {
    return { grade: isRefusal(answer) && forbidden.length === 0 ? "correct_refusal" : "wrong", missing: [], forbidden };
  }
  const missing = item.expect
    .filter((options) => !(Array.isArray(options) ? options : [options]).some((option) => containsValue(answer, option)))
    .map((options) => (Array.isArray(options) ? options.join(" | ") : options));
  if (missing.length === 0 && forbidden.length === 0) return { grade: "exact", missing, forbidden };
  if (forbidden.length === 0 && isRefusal(answer) && missing.length === item.expect.length) return { grade: "unnecessary_refusal", missing, forbidden };
  return { grade: "wrong", missing, forbidden };
}

/** Totals of a run and its verdict. */
export function summarise(rows) {
  const counts = { exact: 0, correct_refusal: 0, unnecessary_refusal: 0, wrong: 0, error: 0 };
  for (const row of rows) counts[row.grade] = (counts[row.grade] ?? 0) + 1;
  const total = rows.length;
  const correct = counts.exact + counts.correct_refusal;
  return { total, ...counts, score: total ? Math.round((correct / total) * 1000) / 10 : 0, passed: counts.wrong === 0 && counts.error === 0 && total > 0 };
}
