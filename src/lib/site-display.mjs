/**
 * Pure display helpers shared by the public pages (site audit 2026-09-23).
 * Plain ESM so `node --test` covers them without a TypeScript toolchain;
 * types live in site-display.d.mts.
 */

/* ── Official round numbers ────────────────────────────────────────
 * `races.round` is the internal calendar slot and still counts the
 * cancelled 2026 rounds (Bahrain, Saudi Arabia). The API exposes
 * `official_round` (formula1.com numbering, null for a cancelled race).
 * Every visible round number uses the official value; `round` stays the
 * key for URLs and API paths.
 *
 * A present `official_round` is not enough: the calendar served before the
 * backend repair numbered races by sorting internal keys and missed the
 * Malaysian Grand Prix, so Singapore came out R16 instead of R17. The value
 * is trusted only when the response envelope certifies its basis with
 * `meta.official_round_basis === OFFICIAL_ROUND_BASIS`. Anything else strips
 * the field at the API boundary, and no round number is ever derived on the
 * client (no position, order or calendar fallback): no number is better than
 * a wrong one. */

export const OFFICIAL_ROUND_BASIS = "formula1.com-chronological-v2";

/** The single trust rule for official round numbers. */
export function hasTrustedOfficialRounds(meta) {
  return meta?.official_round_basis === OFFICIAL_ROUND_BASIS;
}

/**
 * API payload with every `official_round` removed unless `meta` certifies it.
 * Removed, not nulled: null means "cancelled race". Returns a copy.
 */
export function withTrustedOfficialRounds(data, meta) {
  if (hasTrustedOfficialRounds(meta)) return data;
  return stripOfficialRounds(data);
}

function stripOfficialRounds(value) {
  if (Array.isArray(value)) return value.map(stripOfficialRounds);
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "official_round") continue;
    copy[key] = stripOfficialRounds(entry);
  }
  return copy;
}

/**
 * internal round → official round, from a calendar already filtered by
 * withTrustedOfficialRounds. Used only to rewrite article copy whose slug
 * carries the internal round; races resolve their own field.
 */
export function buildOfficialRoundMap(calendar) {
  const map = {};
  for (const race of calendar ?? []) {
    if (!race || race.round == null || !("official_round" in race)) continue;
    const official = race.official_round;
    map[race.round] = typeof official === "number" && Number.isFinite(official) ? official : null;
  }
  return map;
}

/** The race's own trusted `official_round`, or null. Never derived. */
export function resolveOfficialRound(race) {
  if (!race) return null;
  const official = race.official_round;
  return typeof official === "number" && Number.isFinite(official) ? official : null;
}

export function formatOfficialRound(officialRound, { pad = true } = {}) {
  if (officialRound == null || !Number.isFinite(officialRound)) return null;
  return `R${pad ? String(officialRound).padStart(2, "0") : officialRound}`;
}

export function officialRoundLabel(race, options) {
  return formatOfficialRound(resolveOfficialRound(race), options);
}

/**
 * Calendar races in date order. The API lists them by internal round, which
 * places Malaysia (internal 25, official 16) after Abu Dhabi. Dates decide,
 * then the official round; the original order breaks remaining ties.
 */
export function sortRacesChronologically(races) {
  return (races ?? [])
    .map((race, index) => ({ race, index }))
    .sort((a, b) => {
      const dateA = typeof a.race?.date === "string" ? a.race.date : "";
      const dateB = typeof b.race?.date === "string" ? b.race.date : "";
      if (dateA && dateB && dateA !== dateB) return dateA < dateB ? -1 : 1;
      const officialA = a.race?.official_round;
      const officialB = b.race?.official_round;
      if (Number.isFinite(officialA) && Number.isFinite(officialB) && officialA !== officialB) {
        return officialA - officialB;
      }
      return a.index - b.index;
    })
    .map(({ race }) => race);
}

/**
 * Internal round of the chronologically latest race in an API history.
 * Internal keys are not chronological (Malaysia is internal 25 but official
 * 16, before Singapore internal 18 / official 17), so max(round) is wrong.
 * Order by official round when every entry resolves one; otherwise trust the
 * API order, which the backend sorts by season, date, then round.
 */
export function latestChronologicalRound(history) {
  const races = (history ?? []).filter((race) => Number.isInteger(race?.round) && race.round > 0);
  if (races.length === 0) return undefined;
  const officials = races.map((race) => resolveOfficialRound(race));
  if (officials.every((official) => official != null)) {
    let best = 0;
    officials.forEach((official, i) => {
      if (official >= officials[best]) best = i;
    });
    return races[best].round;
  }
  return races.at(-1).round;
}

/**
 * Race article titles and copy were generated with the internal round
 * ("R17: … Preview", "Round 17"). The slug keeps that internal round and must
 * not change, so the text is remapped only when the slug proves it uses the
 * internal number. Text already carrying the official number is untouched.
 * When the official number is unknown (calendar unavailable, no
 * official_round, cancelled slot), the internal label is removed rather than
 * shown: no number is better than a wrong one.
 */
export function remapArticleRoundText(text, slug, map) {
  if (!text || !slug) return text;
  const match = /^r(\d{1,2})-/i.exec(slug);
  if (!match) return text;
  const internal = Number(match[1]);
  const official =
    map && Object.prototype.hasOwnProperty.call(map, internal) ? map[internal] : null;
  if (official === internal) return text;
  if (official == null) return omitArticleRoundLabel(text, internal);
  return text
    // "R17"/"R07" keep the padded form, "R7" stays unpadded.
    .replace(new RegExp(`\\bR0?${internal}\\b`, "g"), (token) =>
      token.length === 3 ? `R${String(official).padStart(2, "0")}` : `R${official}`,
    )
    .replace(new RegExp(`\\bRound ${internal}\\b`, "g"), `Round ${official}`);
}

function omitArticleRoundLabel(text, internal) {
  const label = `(?:R0?${internal}|Round ${internal})(?!\\d)`;
  return text
    // "R17: Azerbaijan …" / "Round 17 · …": leading label and its separator.
    .replace(new RegExp(`\\b${label}\\s*[:·|—–-]\\s*`, "g"), "")
    // "Azerbaijan — Round 17" / "(R17)": trailing or bracketed label.
    .replace(new RegExp(`\\s*(?:[—–·|,]|\\s-)\\s*${label}\\b|\\s*\\(${label}\\)`, "g"), "")
    // Remaining prose ("at Round 17") reads as "this round".
    .replace(new RegExp(`\\b${label}\\b`, "g"), (_token, offset, whole) =>
      /(^|[.!?]\s+)$/.test(whole.slice(0, offset)) ? "This round" : "this round",
    );
}

/**
 * /why/[id]'s versioned binary route (resolveBinaryAt) interprets its
 * trailing index against the UNSCORED binary list for a round, then looks
 * up the same card in the /scored list by (type, title) to show the
 * settled outcome. A sitemap (or anything else linking those URLs) must
 * therefore key its indices off the unscored list's position, not the
 * scored list's own position, or the published URL resolves to the wrong
 * card (or none). Returns one sitemap-ready entry per scored card whose
 * (type, title) is found in `unscoredCards`; unmatched scored cards are
 * dropped rather than linked with a guessed index.
 */
export function mapSettledBinaryIndices(scoredCards, unscoredCards) {
  const unscoredIndexByKey = new Map();
  (unscoredCards ?? []).forEach((card, index) => {
    unscoredIndexByKey.set(`${card.type}::${card.title}`, index);
  });
  const resolved = [];
  for (const card of scoredCards ?? []) {
    const index = unscoredIndexByKey.get(`${card.type}::${card.title}`);
    if (index == null) continue;
    resolved.push({ index, type: card.type, title: card.title });
  }
  return resolved;
}

/* ── Official short race names (NOMENCLATURE.md / formula1.com) ────
 * Sponsor-prefixed or truncated names ("Lenovo Grand Prix",
 * "Formula 1 MSC Cruises Gran Premio de Barcelona-Catalunya 2026") map to the
 * official short name. Order matters: sponsor words ("Qatar Airways") appear
 * in other events' names, so the host country is matched first. */
const SHORT_RACE_NAMES = [
  [/australia/, "Australian Grand Prix"],
  [/chin(a|ese)/, "Chinese Grand Prix"],
  [/japan/, "Japanese Grand Prix"],
  [/bahrain/, "Bahrain Grand Prix"],
  [/saudi/, "Saudi Arabian Grand Prix"],
  [/miami/, "Miami Grand Prix"],
  [/canad/, "Canadian Grand Prix"],
  [/monaco/, "Monaco Grand Prix"],
  [/barcelona|catalunya/, "Barcelona-Catalunya Grand Prix"],
  [/austria/, "Austrian Grand Prix"],
  [/british|great britain/, "British Grand Prix"],
  [/belgi/, "Belgian Grand Prix"],
  [/hungar/, "Hungarian Grand Prix"],
  [/dutch|netherlands/, "Dutch Grand Prix"],
  [/emilia|romagna|imola/, "Emilia-Romagna Grand Prix"],
  [/itali/, "Italian Grand Prix"],
  [/espana|spanish|madrid/, "Spanish Grand Prix"],
  [/azerbaijan|baku/, "Azerbaijan Grand Prix"],
  [/malaysia/, "Malaysian Grand Prix"],
  [/singapore/, "Singapore Grand Prix"],
  [/united states|austin/, "United States Grand Prix"],
  [/mexic/, "Mexico City Grand Prix"],
  [/sao paulo|brazil/, "São Paulo Grand Prix"],
  [/las vegas/, "Las Vegas Grand Prix"],
  [/abu dhabi/, "Abu Dhabi Grand Prix"],
  [/qatar grand prix|lusail/, "Qatar Grand Prix"],
];

function normalizeName(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Official short name, or null when the input cannot be identified. */
export function officialShortRaceName(name) {
  if (!name) return null;
  const normalized = normalizeName(name);
  for (const [pattern, shortName] of SHORT_RACE_NAMES) {
    if (pattern.test(normalized)) return shortName;
  }
  return null;
}

/* ── Three-letter country codes for compact matrix/chart labels ────
 * "Australian" and "Austrian" both truncate to "Aust" at 4 characters,
 * so labels are looked up rather than sliced. Same match order as
 * SHORT_RACE_NAMES (host country before sponsor words). */
const COUNTRY_CODES = [
  [/australia/, "AUS"],
  [/chin(a|ese)/, "CHN"],
  [/japan/, "JPN"],
  [/bahrain/, "BHR"],
  [/saudi/, "KSA"],
  [/miami/, "MIA"],
  [/canad/, "CAN"],
  [/monaco/, "MON"],
  [/barcelona|catalunya/, "BAR"],
  [/austria/, "AUT"],
  [/british|great britain/, "GBR"],
  [/belgi/, "BEL"],
  [/hungar/, "HUN"],
  [/dutch|netherlands/, "NED"],
  [/emilia|romagna|imola/, "EMI"],
  [/itali/, "ITA"],
  [/espana|spanish|madrid/, "ESP"],
  [/azerbaijan|baku/, "AZE"],
  [/malaysia/, "MAL"],
  [/singapore/, "SGP"],
  [/united states|austin/, "USA"],
  [/mexic/, "MEX"],
  [/sao paulo|brazil/, "BRA"],
  [/las vegas/, "LVG"],
  [/abu dhabi/, "ABU"],
  [/qatar grand prix|lusail/, "QAT"],
];

/** Three-letter country code for a race name, or null if unmatched. */
export function raceCountryCode(name) {
  if (!name) return null;
  const normalized = normalizeName(name);
  for (const [pattern, code] of COUNTRY_CODES) {
    if (pattern.test(normalized)) return code;
  }
  return null;
}

/** "Canadian Grand Prix" → "Canadian"; falls back to the cleaned input. */
export function raceLocationLabel(name) {
  const short = officialShortRaceName(name);
  if (short) return short.replace(/ Grand Prix$/, "");
  return String(name ?? "")
    .replace(/^Formula 1\s+/i, "")
    .replace(/\s+\d{4}$/, "")
    .replace(/\s+Grand Prix.*$/i, "")
    .trim();
}

/* ── Nominal host country per race name ─────────────────────────────
 * The country a Grand Prix's name implies (e.g. "Bahrain" for the Bahrain
 * Grand Prix), independent of which circuit actually hosts it a given
 * year. Same match order as SHORT_RACE_NAMES (host country before sponsor
 * words). Used only to flag when the API's real circuit.country diverges
 * from that nominal country (e.g. Bahrain GP run at Sepang, Malaysia),
 * never to invent a location. */
const NOMINAL_COUNTRIES = [
  [/australia/, "Australia"],
  [/chin(a|ese)/, "China"],
  [/japan/, "Japan"],
  [/bahrain/, "Bahrain"],
  [/saudi/, "Saudi Arabia"],
  [/miami/, "United States"],
  [/canad/, "Canada"],
  [/monaco/, "Monaco"],
  [/barcelona|catalunya/, "Spain"],
  [/austria/, "Austria"],
  [/british|great britain/, "United Kingdom"],
  [/belgi/, "Belgium"],
  [/hungar/, "Hungary"],
  [/dutch|netherlands/, "Netherlands"],
  [/emilia|romagna|imola/, "Italy"],
  [/itali/, "Italy"],
  [/espana|spanish|madrid/, "Spain"],
  [/azerbaijan|baku/, "Azerbaijan"],
  [/malaysia/, "Malaysia"],
  [/singapore/, "Singapore"],
  [/united states|austin/, "United States"],
  [/mexic/, "Mexico"],
  [/sao paulo|brazil/, "Brazil"],
  [/las vegas/, "United States"],
  [/abu dhabi/, "United Arab Emirates"],
  [/qatar grand prix|lusail/, "Qatar"],
];

/** Country aliases so a real spelling difference isn't read as a relocation. */
const COUNTRY_ALIASES = [
  ["united states", "usa", "united states of america", "u.s.a."],
  ["united kingdom", "uk", "great britain", "england"],
  ["netherlands", "holland"],
  ["united arab emirates", "uae"],
];

function canonicalCountry(value) {
  const normalized = normalizeName(value).trim();
  for (const group of COUNTRY_ALIASES) {
    if (group.includes(normalized)) return group[0];
  }
  return normalized;
}

function nominalCountry(name) {
  if (!name) return null;
  const normalized = normalizeName(name);
  for (const [pattern, country] of NOMINAL_COUNTRIES) {
    if (pattern.test(normalized)) return country;
  }
  return null;
}

/**
 * Compact card label for a race: the official short name abbreviated to
 * "GP" (e.g. "Bahrain GP"), with "in {circuit country}" appended only when
 * the API's real circuit.country is verifiably different from the country
 * the race's own name implies (e.g. "Bahrain GP in Malaysia" when the
 * Bahrain Grand Prix runs at Sepang). Returns null fields when the name
 * cannot be matched, so callers can fall back to the raw official name.
 */
export function raceCardLabel(name, circuitCountry) {
  const short = officialShortRaceName(name);
  if (!short) return { short: null, full: name ?? null };
  const abbreviated = short.replace(/ Grand Prix$/, " GP");
  const nominal = nominalCountry(name);
  const hostedElsewhere = Boolean(
    nominal && circuitCountry && canonicalCountry(nominal) !== canonicalCountry(circuitCountry),
  );
  return {
    short: hostedElsewhere ? `${abbreviated} in ${circuitCountry}` : abbreviated,
    full: name ?? null,
  };
}

/* ── Probabilities that must not overstate certainty ───────────────
 * A Monte Carlo share of 100% or 0% is a sampling artefact until the
 * outcome is mathematically settled. Show ">99%" / "<1%" instead. */
export function formatBoundedProbability(probability, { settled = false, digits = 0 } = {}) {
  if (probability == null || !Number.isFinite(probability)) return null;
  const pct = Math.min(100, Math.max(0, probability * 100));
  const rounded = pct.toFixed(digits);
  if (settled) return `${rounded}%`;
  const step = 10 ** -digits;
  const ceiling = 100 - step;
  if (Number(rounded) > ceiling) return `>${ceiling.toFixed(digits)}%`;
  if (Number(rounded) < step) return `<${step.toFixed(digits)}%`;
  return `${rounded}%`;
}

/**
 * True when the leader cannot be caught: the gap to P2 exceeds every point
 * still available (sum of maxPointsPerRace over remaining races).
 * `remainingRaces` null/undefined means the calendar is unknown (API outage),
 * which is never the same as "no race left": the title is not settled.
 */
export function isTitleClinched(leaderPoints, secondPoints, remainingRaces) {
  if (![leaderPoints, secondPoints].every(Number.isFinite)) return false;
  if (!Array.isArray(remainingRaces)) return false;
  return leaderPoints - secondPoints > availablePoints(remainingRaces);
}

/**
 * Per-row "title mathematically settled" flags for standings sorted by
 * points: every row is settled once the leader has clinched, and a chaser is
 * settled once it can no longer reach the leader. Unknown calendar → all false.
 */
export function titleSettledFlags(points, remainingRaces) {
  const rows = points ?? [];
  if (!Array.isArray(remainingRaces)) return rows.map(() => false);
  const available = availablePoints(remainingRaces);
  const clinched = rows.length >= 2 && isTitleClinched(rows[0], rows[1], remainingRaces);
  return rows.map((value, i) =>
    clinched || (i > 0 && Number.isFinite(value) && Number.isFinite(rows[0]) && value + available < rows[0]),
  );
}

function availablePoints(remainingRaces) {
  return remainingRaces.reduce(
    (total, race) => total + (Number.isFinite(race?.maxPoints) ? race.maxPoints : 0),
    0,
  );
}

/* ── Track-record matrix outcomes ──────────────────────────────────
 * The API history does not always carry top1_correct/top3_correct. A missing
 * flag is "unknown", never "miss". Top 1 can be derived from the published
 * predicted and actual winners when both are present. */
export function trackRecordOutcome(race, key) {
  if (!race) return null;
  const value = race[key];
  if (typeof value === "boolean") return value;
  if (key === "top1_correct") {
    const predicted = typeof race.predicted_winner === "string" ? race.predicted_winner.trim() : "";
    const actual = typeof race.actual_winner === "string" ? race.actual_winner.trim() : "";
    if (predicted && actual) return normalizeName(predicted) === normalizeName(actual);
  }
  return null;
}

/* ── Article body hygiene ──────────────────────────────────────────
 * Reading time is derived from the text actually rendered (~220 wpm), not
 * from a stored template constant. Identical repeated lines inside a section
 * are generator duplicates and are shown once. */
export function dedupeSectionLines(content) {
  if (!content) return content ?? "";
  const seen = new Set();
  const lines = String(content).split("\n");
  const kept = [];
  for (const line of lines) {
    const key = line.trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function countWords(text) {
  const matches = String(text ?? "").match(/[\p{L}\p{N}][\p{L}\p{N}'’.%-]*/gu);
  return matches ? matches.length : 0;
}

export function estimateReadingMinutes(parts, wordsPerMinute = 220) {
  const words = (parts ?? []).reduce((total, part) => total + countWords(part), 0);
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}
