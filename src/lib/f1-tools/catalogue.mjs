/**
 * F1 tool catalogue: read-only tools over the public The Data Driver API.
 *
 * One definition serves three runtimes: the Data Lab "AI — your own key"
 * mode (tools run in the browser through the same-origin /api/f1 proxy), the
 * Node evaluation bench, and the future public MCP server (JSON Schema via
 * `toolJsonSchemas`). A tool never writes, never guesses and never fills a
 * gap: every result carries its source, licence and public API URL, passes
 * the API's own `{ availability, reason }` through verbatim, and is bounded
 * in size (summaries, not dumps).
 *
 * Plain ESM so `node --test` covers it; types live in catalogue.d.mts.
 */

import { z } from "zod";

// The site enforces a CSP without 'unsafe-eval'. Zod 4 probes `new Function`
// once to decide whether to JIT-compile parsers; the probe is caught but
// Chromium still reports a script-src violation. Jitless mode skips it.
z.config({ jitless: true });
import { withTrustedOfficialRounds } from "../site-display.mjs";
import { matchDrivers, matchRaces } from "./resolve.mjs";

export const DEFAULT_PUBLIC_API_ORIGIN = "https://api.thedatadriver.app";

/** Upper bound of one serialised tool result (characters). */
export const MAX_RESULT_CHARS = 8_000;

const OPENF1_LICENCE = "CC BY-NC-SA 4.0";

// ── Shared input fields ───────────────────────────────────────────────

const season = z.number().int().min(1950).max(2100)
  .describe("Championship year, e.g. 2026.");
const apiRound = z.number().int().min(1).max(99)
  .describe("API round key of the race, from f1_resolve_race or f1_calendar (field api_round). It is NOT the formula1.com round number (official_round): cancelled races keep their slot.");
const driverId = z.number().int().min(1).max(9999)
  .describe("API driver id, from f1_resolve_driver or a standings/results row (field driver_id).");
const limit = (fallback, max) => z.number().int().min(1).max(max).optional()
  .describe(`Maximum rows returned (default ${fallback}, at most ${max}).`);

// ── Formatting helpers ────────────────────────────────────────────────

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const fullName = (row) => [text(row?.first_name), text(row?.last_name)].filter(Boolean).join(" ") || text(row?.driver_name);

export function formatMs(ms) {
  if (!isNumber(ms)) return null;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms - minutes * 60_000) / 1000).toFixed(3);
  return minutes > 0 ? `${minutes}:${seconds.padStart(6, "0")}` : `${seconds}s`;
}

const percent = (value) => (isNumber(value) ? Math.round(value * 1000) / 10 : null);

function rowsOf(data) {
  return Array.isArray(data) ? data.filter((row) => row && typeof row === "object") : [];
}

// ── Provenance ────────────────────────────────────────────────────────

/**
 * Source block of a tool result. OpenF1 payloads are always labelled as
 * non-official enrichment under CC BY-NC-SA 4.0, whatever the tool.
 */
export function describeProvenance(meta, kind, apiUrl) {
  const name = text(meta?.source) ?? "tdd";
  // An OpenF1-backed dataset keeps its licence even when the API answers
  // with an empty or error envelope that names no source.
  const openf1 = name.startsWith("openf1") || kind === "openf1_enrichment";
  return {
    name,
    kind: openf1 ? "openf1_enrichment" : kind,
    licence: openf1 ? text(meta?.license) ?? OPENF1_LICENCE : text(meta?.license),
    attribution: openf1 ? text(meta?.attribution) ?? "Contains data from OpenF1 (https://openf1.org/)." : text(meta?.attribution),
    api_url: apiUrl,
    fetched_at: text(meta?.data_fetched_at) ?? text(meta?.timestamp),
  };
}

/** `{ availability, reason }` exactly as the API wrote them, when present. */
export function availabilityOf(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out = {};
  if (typeof data.availability === "string" && data.availability.trim()) out.availability = data.availability;
  if (typeof data.reason === "string" && data.reason.trim()) out.reason = data.reason;
  return out;
}

/**
 * Keep the first `max` rows; report how many exist so the model can say the
 * list was shortened instead of presenting it as complete.
 */
export function boundRows(rows, max) {
  const list = Array.isArray(rows) ? rows : [];
  return list.length > max ? { rows: list.slice(0, max), truncated: { shown: max, total: list.length } } : { rows: list };
}

/** Longest text field kept as is in a tool result (characters). */
export const MAX_TEXT_CHARS = 600;
/** Appended to a text field cut by fitResult. */
export const TEXT_TRUNCATION_MARK = "…[truncated]";

const serialisedLength = (value) => JSON.stringify(value).length;

/** Copy of `value` with every string longer than `max` cut and marked. */
function clipText(value, max) {
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, Math.max(0, max - TEXT_TRUNCATION_MARK.length))}${TEXT_TRUNCATION_MARK}` : value;
  }
  if (Array.isArray(value)) return value.map((entry) => clipText(entry, max));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clipText(entry, max)]));
  return value;
}

function countClipped(value) {
  if (typeof value === "string") return value.endsWith(TEXT_TRUNCATION_MARK) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countClipped(entry), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((sum, entry) => sum + countClipped(entry), 0);
  return 0;
}

/**
 * Bound a tool result AFTER serialisation: the whole result (data, notes,
 * API error messages) must fit `maxChars`. Long text fields are cut with a
 * marker, then list fields are halved, then text is cut harder; as a last
 * resort the data is dropped with a note. Any cut is reported in
 * `truncated` ({ shown, total } for rows, `text_fields` for cut strings,
 * `original_chars` for the size before bounding), so the model can say the
 * result is partial instead of presenting it as complete.
 */
export function fitResult(result, maxChars = MAX_RESULT_CHARS) {
  const originalChars = serialisedLength(result);
  const { truncated: rowsCut, ...body } = result;
  let rows = rowsCut ?? null;
  let current = clipText(body, MAX_TEXT_CHARS);
  if (originalChars <= maxChars && countClipped(current) === countClipped(body)) return result;
  const assemble = (value) => {
    const textFields = countClipped(value);
    return { ...value, truncated: { ...(rows ?? {}), ...(textFields ? { text_fields: textFields } : {}), original_chars: originalChars } };
  };

  for (let guard = 0; guard < 16 && serialisedLength(assemble(current)) > maxChars; guard += 1) {
    const data = current.data;
    const key = data && typeof data === "object" && !Array.isArray(data)
      ? Object.keys(data).find((name) => Array.isArray(data[name]) && data[name].length > 1)
      : null;
    if (!key) break;
    const shown = Math.max(1, Math.floor(data[key].length / 2));
    rows = { shown, total: rows?.total ?? data[key].length };
    current = { ...current, data: { ...data, [key]: data[key].slice(0, shown) } };
  }
  for (const limit of [300, 150, 80, 40, 20]) {
    if (serialisedLength(assemble(current)) <= maxChars) break;
    current = clipText(current, limit);
  }
  if (serialisedLength(assemble(current)) > maxChars) {
    const { availability, reason } = clipText(current, 200);
    current = { tool: current.tool, ok: current.ok, ...(availability ? { availability } : {}), ...(reason ? { reason } : {}), data: null, note: "The result was too large to return in full: ask for fewer rows.", source: clipText(current.source, 200) };
  }
  return assemble(current);
}

// ── Tool definitions ──────────────────────────────────────────────────

const raceInput = z.strictObject({ season, api_round: apiRound });
const racePath = (suffix) => ({ season: year, api_round }) => `/v1/f1/races/${year}/${api_round}/${suffix}`;

function calendarRow(race) {
  return {
    api_round: race.round ?? null,
    official_round: race.official_round ?? null,
    name: text(race.name),
    date: text(race.date),
    start_time_utc: text(race.time),
    status: text(race.status),
    sprint: typeof race.is_sprint === "boolean" ? race.is_sprint : null,
    circuit: text(race.circuit?.name),
    city: text(race.circuit?.city),
    country: text(race.circuit?.country),
  };
}

function driverRow(row) {
  return { driver_id: row.driver_id ?? null, code: text(row.driver_code), name: fullName(row) };
}

/** @type {import("./catalogue.d.mts").F1ToolDefinition[]} */
export const F1_TOOLS = [
  {
    name: "f1_resolve_race",
    title: "Find a Grand Prix",
    description: "Find races of a season by name, circuit, city, country or demonym (\"Monza\", \"Canadian Grand Prix\"), by formula1.com round (\"round 15\"), or \"next\" / \"latest\". Returns api_round (use it in other tools), official_round, date and status. Call this first whenever a question names a race.",
    inputSchema: z.strictObject({ season, query: z.string().min(1).max(80).describe("Race name or description.") }),
    kind: "official",
    path: ({ season: year }) => `/v1/f1/calendar/${year}`,
    shape: (data, input) => ({ query: input.query, candidates: matchRaces(input.query, rowsOf(data)).map(calendarRow) }),
  },
  {
    name: "f1_resolve_driver",
    title: "Find a driver",
    description: "Find drivers of a season by code (\"VER\"), surname or full name, from the published drivers' standings. Returns driver_id (use it in other tools), code, name and team.",
    inputSchema: z.strictObject({ season, query: z.string().min(1).max(80).describe("Driver code or name.") }),
    kind: "official",
    path: ({ season: year }) => `/v1/f1/standings/drivers/${year}`,
    shape: (data, input) => ({
      query: input.query,
      candidates: matchDrivers(input.query, rowsOf(data)).map((row) => ({ ...driverRow(row), team: text(row.team_name) })),
    }),
  },
  {
    name: "f1_calendar",
    title: "Season calendar",
    description: "All races of a season in API order: api_round, official_round (formula1.com numbering, null when cancelled), name, date, status (completed, upcoming, cancelled), sprint flag and circuit.",
    inputSchema: z.strictObject({ season }),
    kind: "official",
    path: ({ season: year }) => `/v1/f1/calendar/${year}`,
    shape: (data) => ({ races: rowsOf(data).map(calendarRow) }),
  },
  {
    name: "f1_next_race",
    title: "Next race",
    description: "The next scheduled race: name, date, start time (UTC), sprint flag, circuit, api_round and official_round.",
    inputSchema: z.strictObject({}),
    kind: "official",
    path: () => "/v1/f1/calendar/next",
    shape: (data) => ({ race: data && typeof data === "object" && !Array.isArray(data) ? calendarRow(data) : null }),
  },
  {
    name: "f1_driver_standings",
    title: "Drivers' championship",
    description: "Drivers' championship standings of a season (position, driver, team, points, wins), as currently published.",
    inputSchema: z.strictObject({ season, limit: limit(22, 30) }),
    kind: "official",
    path: ({ season: year }) => `/v1/f1/standings/drivers/${year}`,
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data), input.limit ?? 22);
      return { standings: rows.map((row) => ({ position: row.position ?? null, ...driverRow(row), team: text(row.team_name), points: row.points ?? null, wins: row.wins ?? null })), truncated };
    },
  },
  {
    name: "f1_constructor_standings",
    title: "Constructors' championship",
    description: "Constructors' championship standings of a season (position, team, points, wins).",
    inputSchema: z.strictObject({ season }),
    kind: "official",
    path: ({ season: year }) => `/v1/f1/standings/constructors/${year}`,
    shape: (data) => ({ standings: rowsOf(data).map((row) => ({ position: row.position ?? null, team: text(row.team_name), points: row.points ?? null, wins: row.wins ?? null })) }),
  },
  {
    name: "f1_race_results",
    title: "Race classification",
    description: "Official race classification: finishing position, driver, team, grid slot, laps, status (Finished, DNF…), points and fastest-lap flag.",
    inputSchema: raceInput.extend({ limit: limit(22, 30) }),
    kind: "official",
    path: racePath("results"),
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data), input.limit ?? 22);
      return {
        official_round: rows[0]?.official_round ?? null,
        results: rows.map((row) => ({
          position: row.position ?? null, ...driverRow(row), team: text(row.team_name), grid: row.grid ?? null,
          laps: row.laps ?? null, status: text(row.status), points: row.points ?? null, fastest_lap: row.fastest_lap ?? null,
        })),
        truncated,
      };
    },
  },
  {
    name: "f1_qualifying",
    title: "Qualifying classification",
    description: "Official qualifying classification with Q1, Q2 and Q3 times.",
    inputSchema: raceInput.extend({ limit: limit(22, 30) }),
    kind: "official",
    path: racePath("qualifying"),
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data), input.limit ?? 22);
      return {
        qualifying: rows.map((row) => ({
          position: row.position ?? null, ...driverRow(row), team: text(row.team) ?? text(row.team_name),
          q1: text(row.q1), q2: text(row.q2), q3: text(row.q3), classification_status: text(row.classification_status),
        })),
        truncated,
      };
    },
  },
  {
    name: "f1_fastest_laps",
    title: "Fastest laps of a race",
    description: "Each driver's fastest race lap, ranked: lap number, time and gap to the fastest.",
    inputSchema: raceInput.extend({ limit: limit(10, 30) }),
    kind: "official",
    path: racePath("fastest-laps"),
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data?.fastest_laps), input.limit ?? 10);
      return {
        fastest_laps: rows.map((row) => ({
          rank: row.rank ?? null, code: text(row.driver_code), name: fullName(row), lap: row.lap ?? null,
          time: text(row.time_formatted) ?? formatMs(row.time_ms), gap_ms: row.gap_ms ?? null,
        })),
        truncated,
      };
    },
  },
  {
    name: "f1_practice_best",
    title: "Practice best laps",
    description: "Best lap of each driver in one practice session (FP1, FP2 or FP3) of a race weekend, ranked, with gaps.",
    inputSchema: raceInput.extend({ session: z.enum(["FP1", "FP2", "FP3"]).describe("Practice session."), limit: limit(10, 30) }),
    kind: "official",
    path: ({ season: year, api_round, session }) => `/v1/f1/races/${year}/${api_round}/practice/${session}/best`,
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data?.classification), input.limit ?? 10);
      return {
        session: input.session,
        best_laps: rows.map((row) => ({
          rank: row.rank ?? null, code: text(row.driver_code), name: fullName(row),
          time: formatMs(row.best_ms ?? row.time_ms), gap_ms: row.gap_ms ?? null,
        })),
        truncated,
      };
    },
  },
  {
    name: "f1_driver_laps",
    title: "Lap times of one driver",
    description: "Lap-by-lap race times of one driver, summarised: laps timed, best lap, median lap. Pass from_lap/to_lap (at most 20 laps) to list individual laps with sector times.",
    inputSchema: raceInput.extend({
      driver_id: driverId,
      from_lap: z.number().int().min(1).max(100).optional().describe("First lap to list."),
      to_lap: z.number().int().min(1).max(100).optional().describe("Last lap to list (at most 20 laps after from_lap)."),
    }),
    kind: "openf1_enrichment",
    path: ({ season: year, api_round, driver_id }) => `/v1/f1/races/${year}/${api_round}/laps/${driver_id}`,
    shape: (data, input) => {
      const laps = rowsOf(data?.laps);
      const timed = laps.filter((lap) => isNumber(lap.time_ms));
      const best = timed.reduce((min, lap) => (min && min.time_ms <= lap.time_ms ? min : lap), null);
      const sorted = timed.map((lap) => lap.time_ms).sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
      const from = input.from_lap;
      const to = from == null ? null : Math.min(input.to_lap ?? from + 19, from + 19);
      return {
        driver: laps[0] ? { code: text(laps[0].driver_code), name: fullName(laps[0]) } : null,
        laps_recorded: laps.length,
        laps_timed: timed.length,
        best_lap: best ? { lap: best.lap_number ?? null, time: text(best.time_formatted) ?? formatMs(best.time_ms) } : null,
        median_lap_time: formatMs(median),
        laps: from == null ? undefined : laps
          .filter((lap) => isNumber(lap.lap_number) && lap.lap_number >= from && lap.lap_number <= to)
          .map((lap) => ({
            lap: lap.lap_number, time: text(lap.time_formatted) ?? formatMs(lap.time_ms), position: lap.position ?? null,
            s1: formatMs(lap.sector_1_ms), s2: formatMs(lap.sector_2_ms), s3: formatMs(lap.sector_3_ms),
          })),
      };
    },
  },
  {
    name: "f1_pit_stops",
    title: "Pit stops",
    description: "Pit stops of a race (stop number, lap, pit-lane duration, driver), optionally for one driver code, with the stop count and the quickest stop.",
    inputSchema: raceInput.extend({ driver_code: z.string().regex(/^[A-Za-z]{3}$/).optional().describe("Three-letter driver code, e.g. NOR."), limit: limit(30, 60) }),
    kind: "official",
    path: racePath("pitstops"),
    shape: (data, input) => {
      const code = input.driver_code?.toUpperCase();
      const all = rowsOf(data).filter((row) => !code || text(row.driver_code)?.toUpperCase() === code);
      const quickest = all.filter((row) => isNumber(row.duration_ms)).reduce((min, row) => (min && min.duration_ms <= row.duration_ms ? min : row), null);
      const { rows, truncated } = boundRows(all, input.limit ?? 30);
      const row = (stop) => ({ stop: stop.stop ?? null, lap: stop.lap ?? null, duration: formatMs(stop.duration_ms), code: text(stop.driver_code), name: fullName(stop) });
      return { stop_count: all.length, quickest_stop: quickest ? row(quickest) : null, stops: rows.map(row), truncated };
    },
  },
  {
    name: "f1_stints",
    title: "Tyre strategy",
    description: "Tyre stints of a race per driver: compound (SOFT, MEDIUM, HARD, INTERMEDIATE, WET or UNKNOWN), start and end lap, laps and tyre age at the start of the stint, with the compound sequence. stint_changes counts stint boundaries in the OpenF1 stints (not pit stops: a tyre change under a red flag or a missing stint changes it); pit_stops is the driver's count in the official formula1.com pit-stop summary, or null when that summary is unavailable. Optionally one driver code. Stints are non-official OpenF1 enrichment.",
    inputSchema: raceInput.extend({ driver_code: z.string().regex(/^[A-Za-z]{3}$/).optional().describe("Three-letter driver code, e.g. NOR."), limit: limit(10, 22) }),
    kind: "openf1_enrichment",
    path: racePath("stints"),
    // The official pit-stop summary, read alongside so stops are never
    // inferred from stint boundaries.
    related: (input) => ({ pitstops: racePath("pitstops")(input) }),
    shape: (data, input, related = {}) => {
      const code = input.driver_code?.toUpperCase();
      const all = rowsOf(data?.drivers).filter((row) => !code || text(row.driver_code)?.toUpperCase() === code);
      const { rows, truncated } = boundRows(all, input.limit ?? 10);
      const summary = related.pitstops;
      const officialStops = summary?.ok && Array.isArray(summary.data) ? summary.data : null;
      const stopsOf = (row) => {
        if (!officialStops) return null;
        const driver = text(row.driver_code)?.toUpperCase();
        return driver ? officialStops.filter((stop) => text(stop.driver_code)?.toUpperCase() === driver).length : null;
      };
      return {
        race_laps: data?.race_laps ?? null,
        pit_stops_source: officialStops
          ? "formula1.com pit-stop summary (/pitstops)"
          : `Official pit-stop summary unavailable${summary?.status ? ` (HTTP ${summary.status})` : ""}; pit_stops is null and is never inferred from stint changes.`,
        drivers: rows.map((row) => {
          const stints = rowsOf(row.stints).slice(0, 12).map((stint) => ({
            stint: stint.stint_number ?? null, compound: text(stint.compound), start_lap: stint.start_lap ?? null, end_lap: stint.end_lap ?? null,
            laps: stint.laps ?? null, tyre_age_at_start: stint.tyre_age_at_start ?? null,
          }));
          return {
            ...driverRow(row), team: text(row.team_name),
            sequence: stints.map((stint) => stint.compound ?? "UNKNOWN").join("-") || null,
            stint_changes: Math.max(0, stints.length - 1),
            pit_stops: stopsOf(row),
            stints,
          };
        }),
        truncated,
      };
    },
  },
  {
    name: "f1_positions",
    title: "Positions lap by lap",
    description: "Running order of a race: per driver grid, finish, position after lap 1, best and worst running position. places_gained and gain_from_grid mean grid minus finish; recovery_from_lowest_running_position means the lowest position held during the race (grid included) minus finish, and is null unless every race lap is published. These are different measures. Pass driver_code with from_lap/to_lap (at most 20 laps; lap 0 = grid) to list that driver's position on each lap. Missing laps are never interpolated. post_race_adjustments identifies documented official classification changes after the finish. Non-official OpenF1 enrichment; finishing positions remain official.",
    inputSchema: raceInput.extend({
      driver_code: z.string().regex(/^[A-Za-z]{3}$/).optional().describe("Three-letter driver code, e.g. NOR."),
      from_lap: z.number().int().min(0).max(100).optional().describe("First lap to list (0 = grid). Needs driver_code."),
      to_lap: z.number().int().min(0).max(100).optional().describe("Last lap to list (at most 20 laps after from_lap)."),
      limit: limit(22, 30),
    }),
    kind: "openf1_enrichment",
    path: racePath("positions"),
    shape: (data, input) => {
      const code = input.driver_code?.toUpperCase();
      const all = rowsOf(data?.drivers).filter((row) => !code || text(row.driver_code)?.toUpperCase() === code);
      const { rows, truncated } = boundRows(all, input.limit ?? 22);
      const from = code ? input.from_lap : undefined;
      const to = from == null ? null : Math.min(input.to_lap ?? from + 19, from + 19);
      return {
        method: text(data?.method),
        post_race_adjustments: rowsOf(data?.post_race_adjustments).map((item) => ({ driver_code: text(item.driver_code), note: text(item.note), source: text(item.source) })),
        race_laps: data?.race_laps ?? null,
        drivers: rows.map((row) => {
          const points = rowsOf(row.positions).filter((point) => isNumber(point.lap) && isNumber(point.position));
          const running = points.filter((point) => point.lap >= 1).map((point) => point.position);
          const grid = isNumber(row.grid) ? row.grid : points.find((point) => point.lap === 0)?.position ?? null;
          const finish = isNumber(row.finish) ? row.finish : null;
          const complete = isNumber(data?.race_laps) && data.race_laps > 0 && new Set(points.filter((point) => point.lap >= 1 && point.lap <= data.race_laps).map((point) => point.lap)).size === data.race_laps;
          const gainFromGrid = grid != null && grid > 0 && finish != null ? grid - finish : null;
          return {
            ...driverRow(row), team: text(row.team_name), grid, finish,
            lap_1: points.find((point) => point.lap === 1)?.position ?? null,
            best_running: running.length ? Math.min(...running) : null,
            worst_running: running.length ? Math.max(...running) : null,
            places_gained: gainFromGrid,
            gain_from_grid: gainFromGrid,
            recovery_from_lowest_running_position: complete && finish != null ? Math.max(grid ?? 0, ...running) - finish : null,
            laps_with_position: points.length,
            laps: from == null ? undefined : points
              .filter((point) => point.lap >= from && point.lap <= to)
              .map((point) => ({ lap: point.lap, position: point.position })),
          };
        }),
        truncated,
      };
    },
  },
  {
    name: "f1_safety_cars",
    title: "Safety cars",
    description: "Safety car and virtual safety car periods of a race (type, start lap, end lap, reason when published).",
    inputSchema: raceInput,
    kind: "openf1_enrichment",
    path: racePath("safety-cars"),
    shape: (data) => {
      const { rows, truncated } = boundRows(rowsOf(data), 20);
      return { period_count: rowsOf(data).length, periods: rows.map((row) => ({ type: text(row.type), start_lap: row.start_lap ?? null, end_lap: row.end_lap ?? null, reason: text(row.reason) })), truncated };
    },
  },
  {
    name: "f1_incidents",
    title: "Race incidents",
    description: "Race incidents: safety cars, retirements (DNF) and other race-control events, with lap and driver when published.",
    inputSchema: raceInput.extend({ limit: limit(30, 60) }),
    kind: "openf1_enrichment",
    path: racePath("incidents"),
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data), input.limit ?? 30);
      return { incidents: rows.map((row) => ({ type: text(row.type), detail: text(row.incident_type), lap: row.lap ?? null, driver: text(row.driver), description: text(row.description) })), truncated };
    },
  },
  {
    name: "f1_weather",
    title: "Race weather",
    description: "Weather reading for a race: air and track temperature (°C), humidity (%), wind speed (m/s) and direction (°), rainfall flag, and the reading time.",
    inputSchema: raceInput,
    kind: "openf1_enrichment",
    path: racePath("weather"),
    shape: (data) => (data && typeof data === "object" && !Array.isArray(data)
      ? { weather: { air_temp_c: data.air_temp ?? null, track_temp_c: data.track_temp ?? null, humidity_pct: data.humidity ?? null, wind_speed_ms: data.wind_speed ?? null, wind_direction_deg: data.wind_direction ?? null, rainfall: data.rainfall ?? null, reading_time: text(data.timestamp) } }
      : { weather: null }),
  },
  {
    name: "f1_race_forecast",
    title: "Race forecast",
    description: "The Data Driver model forecast for a race: win, podium, points and DNF probabilities (percent) and expected position/points per driver. A forecast is a model output, never a result.",
    inputSchema: raceInput.extend({ limit: limit(10, 22) }),
    kind: "forecast",
    path: ({ season: year, api_round }) => `/v1/f1/predictions/race/${year}/${api_round}`,
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data?.predictions), input.limit ?? 10);
      return {
        race: text(data?.race), race_status: text(data?.status), generated_at: text(data?.generated_at), model_version: text(data?.model_version),
        forecast: rows.map((row) => ({
          rank: row.rank ?? null, driver_id: row.driver_id ?? null, code: text(row.driver_code), name: fullName(row),
          win_pct: percent(row.p_win), podium_pct: percent(row.p_podium), points_pct: percent(row.p_points), dnf_pct: percent(row.p_dnf),
          expected_position: row.e_position ?? null, expected_points: row.e_points ?? null,
        })),
        truncated,
      };
    },
  },
  {
    name: "f1_qualifying_forecast",
    title: "Qualifying forecast",
    description: "The Data Driver model forecast for qualifying: expected position, pole and Q3 probabilities (percent). A forecast is a model output, never a result.",
    inputSchema: raceInput.extend({ limit: limit(10, 22) }),
    kind: "forecast",
    path: ({ season: year, api_round }) => `/v1/f1/predictions/qualifying/${year}/${api_round}`,
    shape: (data, input) => {
      const { rows, truncated } = boundRows(rowsOf(data), input.limit ?? 10);
      return {
        forecast: rows.map((row) => ({
          position: row.position ?? null, code: text(row.driver_code), name: fullName(row),
          expected_position: row.expected_position ?? null, pole_pct: percent(row.p_pole), q3_pct: percent(row.p_q3),
        })),
        truncated,
      };
    },
  },
  {
    name: "f1_head_to_head",
    title: "Driver head-to-head",
    description: "Head-to-head record of two drivers: races and qualifying sessions where each finished ahead (career and current season), plus the model's probability that driver 1 finishes ahead at the next race.",
    inputSchema: z.strictObject({ driver_id_1: driverId, driver_id_2: driverId }),
    kind: "derived",
    path: ({ driver_id_1, driver_id_2 }) => `/v1/f1/drivers/${driver_id_1}/head-to-head/${driver_id_2}`,
    shape: (data) => {
      const person = (driver) => (driver ? { driver_id: driver.id ?? null, code: text(driver.code), name: fullName(driver) } : null);
      const record = (value) => (value ? { driver1_ahead: value.driver1_wins ?? null, driver2_ahead: value.driver2_wins ?? null, total: value.total ?? null } : null);
      return {
        driver1: person(data?.driver1), driver2: person(data?.driver2),
        races_all_time: record(data?.race_h2h), races_this_season: record(data?.season_race_h2h), qualifying_all_time: record(data?.quali_h2h),
        next_race_forecast: data?.prediction ? { api_round: data.prediction.round ?? null, driver1_ahead_pct: percent(data.prediction.p_driver1_ahead) } : null,
      };
    },
  },
  {
    name: "f1_race_data_status",
    title: "Race data status",
    description: "Which official datasets of a race are published (classification, qualifying, fastest laps, pit stops…), with the reason when one is missing.",
    inputSchema: raceInput,
    kind: "official",
    path: racePath("ingestion-readiness"),
    shape: (data) => {
      const { rows, truncated } = boundRows(rowsOf(data?.datasets), 20);
      return {
        ready: data?.ready ?? null,
        status: text(data?.status),
        datasets: rows.map((row) => ({
          dataset: text(row.dataset), status: text(row.status), reason: text(row.reason), source: text(row.source?.label), source_url: text(row.source?.url),
        })),
        truncated,
      };
    },
  },
];

// ── Fetchers ──────────────────────────────────────────────────────────

/**
 * @typedef {{ status: number, body: unknown }} FetchResult
 * @typedef {(path: string) => Promise<FetchResult>} F1Fetcher
 */

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return { status: "error", error: { code: response.status, message: `Response was not JSON (${error instanceof Error ? error.name : "parse error"}).` } };
  }
}

/** Browser fetcher: same-origin proxy, no credentials or extra headers. */
export function createProxyFetcher(base = "/api/f1", timeoutMs = 10_000) {
  return async (path) => {
    const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, body: await readJson(response) };
  };
}

/** Node fetcher straight to an API origin (evaluation bench, MCP server). */
export function createHttpFetcher(apiBase = DEFAULT_PUBLIC_API_ORIGIN, timeoutMs = 15_000) {
  const base = apiBase.replace(/\/+$/, "");
  return async (path) => {
    const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, body: await readJson(response) };
  };
}

/** Fetcher over a frozen `{ path: { status, body } }` snapshot (tests, CI). */
export function createSnapshotFetcher(snapshot) {
  return async (path) => {
    const entry = snapshot?.[path];
    if (!entry) return { status: 404, body: { status: "error", error: { code: 404, message: "Not in snapshot." } } };
    return { status: entry.status, body: entry.body };
  };
}

// ── Runner ────────────────────────────────────────────────────────────

/**
 * @param {{ fetchJson: F1Fetcher, publicOrigin?: string }} options
 */
export function createF1ToolRunner({ fetchJson, publicOrigin = DEFAULT_PUBLIC_API_ORIGIN }) {
  const origin = publicOrigin.replace(/\/+$/, "");
  const cache = new Map();
  const byName = new Map(F1_TOOLS.map((tool) => [tool.name, tool]));

  function load(path) {
    if (!cache.has(path)) {
      const pending = fetchJson(path).catch((error) => {
        cache.delete(path);
        return { status: 0, body: { status: "error", error: { code: 0, message: error instanceof Error ? error.message : "Network error" } } };
      });
      cache.set(path, pending);
    }
    return cache.get(path);
  }

  /**
   * Companion datasets a tool reads next to its main path (e.g. the official
   * pit-stop summary for f1_stints): `{ key: { ok, status, data } }`. A
   * failure is passed on as `ok: false`, never as an empty dataset.
   */
  async function loadRelated(paths) {
    const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
      const { status, body } = await load(path);
      const envelope = body && typeof body === "object" ? body : {};
      const ok = status >= 200 && status < 300 && envelope.status !== "error";
      return [key, { ok, status, data: ok ? envelope.data ?? null : null }];
    }));
    return Object.fromEntries(entries);
  }

  /**
   * Run one tool. Never throws: invalid input, HTTP errors and network
   * failures come back as `{ ok: false, error }` the model can report.
   */
  async function call(name, rawInput) {
    const tool = byName.get(name);
    if (!tool) return { tool: name, ok: false, error: { status: null, message: `Unknown tool ${name}.` } };
    const parsed = tool.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return { tool: name, ok: false, error: { status: null, message: `Invalid input: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}` } };
    }
    const input = parsed.data;
    const path = tool.path(input);
    const apiUrl = `${origin}${path}`;
    const { status, body } = await load(path);
    const envelope = body && typeof body === "object" ? body : {};
    if (status < 200 || status >= 300 || envelope.status === "error") {
      const message = status >= 500 ? "Upstream API unavailable." : text(envelope.error?.message) ?? text(envelope.detail) ?? `The API answered ${status}.`;
      return fitResult({ tool: name, ok: false, error: { status, message }, source: describeProvenance(null, tool.kind, apiUrl) });
    }
    const meta = envelope.meta ?? null;
    const data = withTrustedOfficialRounds(envelope.data ?? null, meta);
    const source = describeProvenance(meta, tool.kind, apiUrl);
    if (data == null) {
      return { tool: name, ok: true, data: null, empty: true, note: "The API published no data for this request.", source };
    }
    const shaped = tool.shape(data, input, tool.related ? await loadRelated(tool.related(input)) : undefined);
    const { truncated, ...rest } = shaped;
    const result = { tool: name, ok: true, ...availabilityOf(data), data: rest, ...(truncated ? { truncated } : {}), source };
    return fitResult(result);
  }

  return { call, tools: F1_TOOLS };
}

/** JSON Schema of every tool input (MCP `tools/list`, documentation). */
export function toolJsonSchemas() {
  return F1_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema),
  }));
}
