/**
 * Paths the same-origin `/api/f1/...` proxy forwards to the upstream API.
 *
 * Only the read-only endpoints the Lab consumes are listed (plus the grounded
 * chat endpoint, the single POST). Anything else answers 404 without an
 * upstream request, so the proxy cannot be used as an open relay.
 */

const SEASON = String.raw`\d{4}`;
const ROUND = String.raw`\d{1,2}`;
const ID = String.raw`\d{1,4}`;
const SESSION = "(FP1|FP2|FP3)";

const GET_PATTERNS = [
  String.raw`v1/health`,
  `v1/f1/calendar/(${SEASON}|next)`,
  `v1/f1/circuits`,
  `v1/f1/standings/(drivers|constructors)/${SEASON}`,
  `v1/f1/races/${SEASON}/${ROUND}/(results|qualifying|fastest-laps|pitstops|safety-cars|incidents|weather|ingestion-readiness)`,
  `v1/f1/races/${SEASON}/${ROUND}/(stints|positions)`,
  `v1/f1/races/${SEASON}/${ROUND}/(laps|telemetry)/${ID}`,
  `v1/f1/races/${SEASON}/${ROUND}/practice/${SESSION}/best`,
  `v1/f1/predictions/(race|qualifying)/${SEASON}/${ROUND}`,
  `v1/f1/drivers/${ID}/head-to-head/${ID}`,
].map((pattern) => new RegExp(`^${pattern}$`));

const POST_PATTERNS = [/^v1\/f1\/chat$/];

/** Largest grounded-chat request body the proxy forwards (bytes). */
export const MAX_POST_BYTES = 8 * 1024;

/**
 * @param {string} method HTTP method of the incoming request.
 * @param {string[]} segments Path segments after `/api/f1/`.
 * @returns {boolean}
 */
export function isAllowedProxyPath(method, segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/%?#]/.test(segment))) return false;
  const path = segments.join("/");
  if (method === "GET" || method === "HEAD") return GET_PATTERNS.some((pattern) => pattern.test(path));
  if (method === "POST") return POST_PATTERNS.some((pattern) => pattern.test(path));
  return false;
}
