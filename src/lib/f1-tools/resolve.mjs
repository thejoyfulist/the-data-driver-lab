/**
 * Name resolution for the F1 tool catalogue: driver and Grand Prix lookups
 * done on the client from the published calendar and standings. Nothing is
 * guessed: a query either matches published fields or returns no candidate.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "at", "grand", "prix", "gp", "race", "formula", "f1", "1", "gran", "premio", "grande",
  "premio", "de", "du", "d", "la", "el", "who", "won", "season",
]);

// Demonyms and common English names → words that appear in the official
// event, circuit, city or country fields.
const RACE_ALIASES = {
  australian: ["australia", "melbourne"],
  chinese: ["china", "shanghai"],
  japanese: ["japan", "suzuka"],
  bahraini: ["bahrain"],
  saudi: ["saudi", "arabia", "jeddah"],
  canadian: ["canada", "montreal"],
  monegasque: ["monaco"],
  spanish: ["espana"],
  spain: ["espana"],
  catalan: ["barcelona", "catalunya"],
  catalunya: ["barcelona", "catalunya"],
  austrian: ["austria"],
  british: ["british", "silverstone"],
  silverstone: ["british"],
  belgian: ["belgium", "belgian", "spa"],
  hungarian: ["hungary", "hungarian"],
  dutch: ["netherlands", "dutch", "zandvoort"],
  italian: ["italia", "italy", "monza"],
  italy: ["italia"],
  monza: ["italia"],
  azerbaijani: ["azerbaijan", "baku"],
  baku: ["azerbaijan"],
  malaysian: ["malaysia"],
  american: ["united", "states", "austin"],
  usa: ["united", "states"],
  us: ["united", "states"],
  cota: ["united", "states", "austin"],
  mexican: ["mexico"],
  brazilian: ["sao", "paulo", "brazil"],
  brazil: ["sao", "paulo"],
  interlagos: ["sao", "paulo"],
  vegas: ["las", "vegas"],
  qatari: ["qatar"],
  emirati: ["abu", "dhabi"],
  yas: ["abu", "dhabi"],
};

/** Lower case, accents removed, punctuation as spaces. */
export function normaliseText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return normaliseText(value).split(" ").filter(Boolean);
}

function queryTokens(query) {
  return tokens(query).filter((token) => !STOP_WORDS.has(token) && !/^(19|20)\d{2}$/.test(token));
}

/**
 * Drivers whose code, first name, last name or full name match the query.
 * @param {string} query
 * @param {Array<Record<string, unknown>>} standings rows of /standings/drivers/{season}
 */
export function matchDrivers(query, standings, limit = 5) {
  const wanted = normaliseText(query);
  const wantedTokens = tokens(query);
  if (!wanted) return [];
  const scored = [];
  for (const row of Array.isArray(standings) ? standings : []) {
    if (!row || typeof row !== "object") continue;
    const code = normaliseText(row.driver_code);
    const first = normaliseText(row.first_name);
    const last = normaliseText(row.last_name);
    const full = `${first} ${last}`.trim();
    let score = 0;
    if (code && wanted === code) score = 100;
    else if (full && wanted === full) score = 95;
    else if (last && wanted === last) score = 90;
    else if (first && wanted === first) score = 60;
    else if (wantedTokens.length > 0 && wantedTokens.every((token) => full.split(" ").includes(token))) score = 80;
    else if (wanted.length >= 3 && full.includes(wanted)) score = 40;
    if (score > 0) scored.push({ score, row });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ row }) => row);
}

/**
 * Calendar races matching a free-text query ("Monza", "Canadian Grand Prix",
 * "round 15", "next", "latest").
 * @param {string} query
 * @param {Array<Record<string, any>>} calendar rows of /calendar/{season}
 */
export function matchRaces(query, calendar, limit = 5) {
  const races = (Array.isArray(calendar) ? calendar : []).filter((race) => race && typeof race === "object");
  const wanted = normaliseText(query);
  if (!wanted) return [];

  const roundMatch = wanted.match(/^(?:round|r|rd)\s*(\d{1,2})$/);
  if (roundMatch) {
    const official = Number(roundMatch[1]);
    return races.filter((race) => race.official_round === official).slice(0, limit);
  }
  const byDate = [...races].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  if (/^(next|upcoming|next race)$/.test(wanted)) {
    return byDate.filter((race) => race.status === "upcoming").slice(0, 1);
  }
  if (/^(last|latest|previous|most recent|last race|latest race)$/.test(wanted)) {
    return byDate.filter((race) => race.status === "completed").slice(-1);
  }

  const wantedTokens = queryTokens(query).flatMap((token) => [token, ...(RACE_ALIASES[token] ?? [])]);
  const plain = queryTokens(query);
  if (plain.length === 0) return [];
  const scored = [];
  for (const race of races) {
    const corpus = new Set(tokens([race.name, race.circuit?.name, race.circuit?.city, race.circuit?.country].join(" ")));
    // Every word of the query (or one of its aliases) must appear.
    const matchedAll = plain.every((token) => corpus.has(token) || (RACE_ALIASES[token] ?? []).some((alias) => corpus.has(alias)));
    if (!matchedAll) continue;
    const score = wantedTokens.filter((token) => corpus.has(token)).length;
    scored.push({ score, race });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ race }) => race);
}
