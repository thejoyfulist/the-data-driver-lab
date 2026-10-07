/**
 * Grading of one answer against the frozen truth.
 *
 *   exact               the answer asserts every expected value, negates none
 *                       and contains nothing forbidden
 *   correct_refusal     an unanswerable question answered "not available"
 *   unnecessary_refusal an answerable question refused (a failed question)
 *   wrong               a missing, negated or contradicting value, a made-up
 *                       answer, or (structured format) no valid answer block
 *   error               the provider or endpoint failed; no answer to grade
 *
 * Two formats:
 *   structured  AI runs (mock and provider). The model must end with a JSON
 *               block {"answer_value": …, "refused": bool} (see
 *               STRUCTURED_ANSWER_RULE). The values are compared one by one
 *               with the truth (no substring search), and the prose before
 *               the block must not negate an expected value.
 *   prose       the deterministic endpoint, which answers in sentences. An
 *               expected value counts only when it appears in a clause that
 *               does not negate it ("X is not the leader; Y is" is wrong).
 *
 * A run passes only with zero "wrong", zero "error" and exact answers for at
 * least `minExact` (default 90 %) of the answerable questions.
 */

export const DEFAULT_MIN_EXACT = 0.9;

/** Instruction added to the system prompt of AI bench runs. */
export const STRUCTURED_ANSWER_RULE = [
  "Finish your reply with a fenced JSON block and nothing after it:",
  "```json",
  "{\"answer_value\": <the bare value, or a list of values, that answers the question, exactly as the tools returned it (name, number, time, date, status); null when refused>, \"refused\": <true only when the answer is not available>}",
  "```",
].join("\n");

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

/** Negation inside a clause (text already normalised: apostrophes are spaces). */
const NEGATION = /\b(?:not|never|no longer|neither|nor|isn t|wasn t|aren t|weren t|doesn t|didn t|hasn t|haven t|hadn t|won t|cannot|can t|incorrect|false|wrong)\b/;

export function normaliseAnswer(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valuePattern(needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^a-z0-9.])${escaped}(?![0-9]|\\.[0-9])(?![a-z])`);
  // A number may be followed by letters ("25pts", "2nd"): accept a digit boundary for numeric needles.
  const number = /^\d+(\.\d+)?$/.test(needle) ? new RegExp(`(^|[^0-9.])${escaped}(?![0-9]|\\.[0-9])`) : null;
  return (text) => word.test(text) || Boolean(number?.test(text));
}

/** True when the answer contains `needle` as a whole token run (so "5" does not match "15"). */
export function containsValue(answer, needle) {
  const value = normaliseAnswer(needle);
  return Boolean(value) && valuePattern(value)(normaliseAnswer(answer));
}

export function isRefusal(answer) {
  const text = normaliseAnswer(answer);
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

/** Clauses of a normalised text: sentences, semicolons, commas and "but". */
function clauses(text) {
  return text.split(/[.;:!?\n]+(?:\s|$)|,|\b(?:but|whereas|while|although|however)\b/).map((part) => part.trim()).filter(Boolean);
}

/**
 * How `needle` appears in prose: "asserted" (in a clause without negation),
 * "negated" (only in negated clauses) or "absent".
 */
export function valueStance(prose, needle) {
  const value = normaliseAnswer(needle);
  if (!value) return "absent";
  const matches = valuePattern(value);
  const found = clauses(normaliseAnswer(prose)).filter((clause) => matches(clause));
  if (found.length === 0) return "absent";
  return found.some((clause) => !NEGATION.test(clause)) ? "asserted" : "negated";
}

/**
 * The trailing {"answer_value", "refused"} block of a structured answer, and
 * the prose before it; `block` is null when it is missing or malformed.
 */
export function extractStructured(answer) {
  const text = String(answer ?? "");
  const fenced = [...text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].at(-1);
  const bare = fenced ? null : text.match(/(\{[^{}]*"answer_value"[^{}]*\})\s*$/);
  const match = fenced ?? bare;
  if (!match) return { block: null, prose: text };
  const prose = text.slice(0, match.index).trim();
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { block: null, prose };
  }
  const scalar = (entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry);
  const valid = parsed && typeof parsed === "object" && typeof parsed.refused === "boolean" && Object.hasOwn(parsed, "answer_value") &&
    (scalar(parsed.answer_value) || (Array.isArray(parsed.answer_value) && parsed.answer_value.every(scalar)));
  return { block: valid ? parsed : null, prose };
}

const ORDINAL = /^p?(\d+)(?:st|nd|rd|th)?$/;
const MEASURE = /^(-?\d+(?:\.\d+)?)\s*(?:%|per cent|percent|pts|points?|laps?|°c|c|deg|degrees|s|seconds?)?$/;

/** Strict comparison of one expected spelling with one structured value. */
export function valueMatches(expected, given) {
  const want = normaliseAnswer(expected).replace(/^the /, "");
  const got = normaliseAnswer(given).replace(/^the /, "");
  if (!want || !got) return false;
  if (want === got) return true;
  const [wantOrdinal, gotOrdinal] = [want.match(ORDINAL), got.match(ORDINAL)];
  if (wantOrdinal && gotOrdinal) return Number(wantOrdinal[1]) === Number(gotOrdinal[1]);
  const [wantMeasure, gotMeasure] = [want.match(MEASURE), got.match(MEASURE)];
  if (wantMeasure && gotMeasure) return Number(wantMeasure[1]) === Number(gotMeasure[1]);
  // A date may carry its year ("11 October" → "11 October 2026").
  if (new RegExp(`^${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},? \\d{4}$`).test(got)) return true;
  // A surname may be given as a full name ("Norris" → "Lando Norris"): one
  // or two first names, letters only, no list.
  return /^[a-z][a-z-]*$/.test(want) && /^[a-z][a-z .-]*$/.test(got) && got.split(" ").length <= 3 && got.endsWith(` ${want}`) &&
    !NEGATION.test(got);
}

const optionsOf = (options) => (Array.isArray(options) ? options : [options]);
const labelOf = (options) => optionsOf(options).join(" | ");

function gradeStructured(item, answer, forbidden) {
  const { block, prose } = extractStructured(answer);
  if (!block) return { grade: "wrong", missing: item.expect.map(labelOf), forbidden, negated: [], note: "no valid answer block" };
  const values = (Array.isArray(block.answer_value) ? block.answer_value : [block.answer_value]).filter((entry) => entry !== null && entry !== "");
  if (item.kind === "refusal") {
    const ok = block.refused && values.length === 0 && forbidden.length === 0;
    return { grade: ok ? "correct_refusal" : "wrong", missing: [], forbidden, negated: [] };
  }
  if (block.refused) {
    return { grade: values.length === 0 && forbidden.length === 0 ? "unnecessary_refusal" : "wrong", missing: item.expect.map(labelOf), forbidden, negated: [] };
  }
  const missing = item.expect.filter((options) => !values.some((value) => optionsOf(options).some((option) => valueMatches(option, value)))).map(labelOf);
  const negated = item.expect.filter((options) => optionsOf(options).some((option) => valueStance(prose, option) === "negated")).map(labelOf);
  const grade = missing.length === 0 && negated.length === 0 && forbidden.length === 0 ? "exact" : "wrong";
  return { grade, missing, forbidden, negated };
}

function gradeProse(item, answer, forbidden) {
  if (item.kind === "refusal") {
    return { grade: isRefusal(answer) && forbidden.length === 0 ? "correct_refusal" : "wrong", missing: [], forbidden, negated: [] };
  }
  const stances = item.expect.map((options) => {
    const found = optionsOf(options).map((option) => valueStance(answer, option));
    return found.includes("asserted") ? "asserted" : found.includes("negated") ? "negated" : "absent";
  });
  const missing = item.expect.filter((_, index) => stances[index] !== "asserted").map(labelOf);
  const negated = item.expect.filter((_, index) => stances[index] === "negated").map(labelOf);
  if (missing.length === 0 && forbidden.length === 0) return { grade: "exact", missing, forbidden, negated };
  const refused = forbidden.length === 0 && negated.length === 0 && isRefusal(answer) && missing.length === item.expect.length;
  return { grade: refused ? "unnecessary_refusal" : "wrong", missing, forbidden, negated };
}

/**
 * @param {{ kind: "answer" | "refusal", expect: Array<string | string[]>, forbid?: string[] }} item
 * @param {string | null} answer
 * @param {{ format?: "structured" | "prose" }} [options]
 * @returns {{ grade: string, missing: string[], forbidden: string[], negated: string[], note?: string }}
 */
export function gradeAnswer(item, answer, { format = "prose" } = {}) {
  if (answer == null) return { grade: "error", missing: [], forbidden: [], negated: [] };
  const forbidden = (item.forbid ?? []).filter((value) => valueStance(answer, value) === "asserted");
  return format === "structured" ? gradeStructured(item, answer, forbidden) : gradeProse(item, answer, forbidden);
}

/**
 * Totals of a run and its verdict.
 * @param {Array<{ grade: string, kind?: string }>} rows
 * @param {{ minExact?: number }} [options] share of answerable questions that must be exact
 */
export function summarise(rows, { minExact = DEFAULT_MIN_EXACT } = {}) {
  const counts = { exact: 0, correct_refusal: 0, unnecessary_refusal: 0, wrong: 0, error: 0 };
  for (const row of rows) counts[row.grade] = (counts[row.grade] ?? 0) + 1;
  const total = rows.length;
  const answerable = rows.filter((row) => row.kind !== "refusal").length;
  const correct = counts.exact + counts.correct_refusal;
  const exactRate = answerable ? counts.exact / answerable : 1;
  const passed = total > 0 && counts.wrong === 0 && counts.error === 0 && exactRate >= minExact;
  return {
    total,
    answerable,
    ...counts,
    score: total ? Math.round((correct / total) * 1000) / 10 : 0,
    exact_rate: Math.round(exactRate * 1000) / 10,
    min_exact: Math.round(minExact * 1000) / 10,
    passed,
  };
}
