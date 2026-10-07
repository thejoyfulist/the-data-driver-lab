/**
 * Tyre strategy and lap-by-lap positions for the Data Lab (lot H): pure
 * helpers over the `/stints` and `/positions` payloads, so node --test covers
 * them. Nothing here fills a gap: a lap without a published position stays
 * absent (never interpolated), a stint without a compound stays "not
 * published", and a figure that cannot be computed says so.
 */

import { rankPositionGains } from "./lab-grounded-queries.mjs";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isInt = (value) => Number.isInteger(value);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

function fullName(row) {
  const name = `${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim();
  return name || text(row?.driver_code) || "Unnamed driver";
}

function naturalList(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// ── Compounds ───────────────────────────────────────────────────────────

/**
 * Usual Pirelli sidewall colours. Each compound also has a letter and a fill
 * pattern, so the strategy reads without colour (colour-blind readers, print).
 * `text` keeps ≥ 4.5:1 contrast on `fill`.
 */
export const TYRE_COMPOUNDS = {
  SOFT: { id: "SOFT", letter: "S", label: "Soft", fill: "#DA291C", text: "#FFFFFF", pattern: "solid" },
  MEDIUM: { id: "MEDIUM", letter: "M", label: "Medium", fill: "#FFD12E", text: "#09090B", pattern: "diagonal" },
  HARD: { id: "HARD", letter: "H", label: "Hard", fill: "#F0F0EC", text: "#09090B", pattern: "crosshatch" },
  INTERMEDIATE: { id: "INTERMEDIATE", letter: "I", label: "Intermediate", fill: "#43B02A", text: "#09090B", pattern: "horizontal" },
  WET: { id: "WET", letter: "W", label: "Wet", fill: "#0067AD", text: "#FFFFFF", pattern: "vertical" },
  UNKNOWN: { id: "UNKNOWN", letter: "?", label: "Compound not published", fill: "#3F3F46", text: "#FAFAF8", pattern: "dotted" },
};

export const COMPOUND_ORDER = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "UNKNOWN"];

/** API compound string → key of TYRE_COMPOUNDS; anything unrecognised is UNKNOWN. */
export function normaliseCompound(value) {
  const name = text(value)?.toUpperCase() ?? "";
  if (name === "INTER") return "INTERMEDIATE";
  return name in TYRE_COMPOUNDS ? name : "UNKNOWN";
}

// ── Shared reading ──────────────────────────────────────────────────────

const driversOf = (data) => (data && typeof data === "object" && Array.isArray(data.drivers) ? data.drivers.filter((row) => row && typeof row === "object") : []);

function availabilityOf(data) {
  const availability = text(data?.availability);
  return { availability, reason: text(data?.reason) };
}

function resultFor(results, driver) {
  const list = Array.isArray(results) ? results : [];
  const code = text(driver?.driver_code)?.toUpperCase();
  return list.find((row) => isInt(driver?.driver_id) && row?.driver_id === driver.driver_id)
    ?? list.find((row) => code && text(row?.driver_code)?.toUpperCase() === code)
    ?? null;
}

const byFinish = (a, b) => (a.finish ?? 999) - (b.finish ?? 999) || a.code.localeCompare(b.code);

// ── Tyre strategy (/stints) ─────────────────────────────────────────────

/**
 * Rows of the strategy chart, ordered by finishing position (official
 * classification when given, unclassified drivers last). Pit stops come from
 * the official pit-stop summary when it lists the driver; otherwise the lap a
 * stint ends before another starts is marked as a stint change (`derived`).
 *
 * @returns {{ availability: string|null, reason: string|null, raceLaps: number|null, maxLap: number, rows: object[] }}
 */
export function buildTyreStrategy(data, results = [], pitStops = []) {
  const { availability, reason } = availabilityOf(data);
  const stopsByCode = new Map();
  for (const stop of Array.isArray(pitStops) ? pitStops : []) {
    const code = text(stop?.driver_code)?.toUpperCase();
    if (!code || !isInt(stop?.lap)) continue;
    stopsByCode.set(code, [...(stopsByCode.get(code) ?? []), { lap: stop.lap, durationMs: isNumber(stop.duration_ms) ? stop.duration_ms : null }]);
  }
  const rows = driversOf(data).map((driver) => {
    const result = resultFor(results, driver);
    const code = text(driver.driver_code)?.toUpperCase() ?? text(result?.driver_code)?.toUpperCase() ?? "—";
    const stints = (Array.isArray(driver.stints) ? driver.stints : [])
      .filter((stint) => isInt(stint?.start_lap) && isInt(stint?.end_lap) && stint.start_lap >= 1 && stint.end_lap >= stint.start_lap)
      .sort((a, b) => a.start_lap - b.start_lap)
      .map((stint, index) => ({
        number: isInt(stint.stint_number) ? stint.stint_number : index + 1,
        compound: normaliseCompound(stint.compound),
        start: stint.start_lap,
        end: stint.end_lap,
        laps: isInt(stint.laps) && stint.laps > 0 ? stint.laps : stint.end_lap - stint.start_lap + 1,
        ageAtStart: isInt(stint.tyre_age_at_start) && stint.tyre_age_at_start >= 0 ? stint.tyre_age_at_start : null,
      }));
    const official = (stopsByCode.get(code) ?? []).sort((a, b) => a.lap - b.lap);
    const stops = official.length
      ? official.map((stop) => ({ ...stop, derived: false }))
      : stints.slice(1).map((stint, index) => ({ lap: stints[index].end, durationMs: null, derived: true }));
    return {
      driverId: isInt(driver.driver_id) ? driver.driver_id : null,
      code,
      name: fullName(driver),
      team: text(driver.team_name) ?? text(result?.team_name) ?? "",
      finish: isInt(result?.position) ? result.position : null,
      stints,
      stops,
    };
  }).filter((row) => row.stints.length > 0).sort(byFinish);
  const raceLaps = isInt(data?.race_laps) && data.race_laps > 0 ? data.race_laps : null;
  const maxLap = Math.max(raceLaps ?? 0, ...rows.flatMap((row) => row.stints.map((stint) => stint.end)), 1);
  return { availability, reason, raceLaps, maxLap, rows };
}

/** "M–H" (or "S–M–S") for one row: the compound letters in stint order. */
export function compoundSequence(row) {
  return (row?.stints ?? []).map((stint) => TYRE_COMPOUNDS[stint.compound]?.letter ?? "?").join("–");
}

/** Short, factual summary of a stint for tooltips and screen readers. */
export function describeStint(stint) {
  const compound = TYRE_COMPOUNDS[stint.compound] ?? TYRE_COMPOUNDS.UNKNOWN;
  const age = stint.ageAtStart == null ? "tyre age not published" : stint.ageAtStart === 0 ? "new tyres" : `tyres ${stint.ageAtStart} ${stint.ageAtStart === 1 ? "lap" : "laps"} old at the start`;
  return `${compound.label}, laps ${stint.start}–${stint.end} (${stint.laps} ${stint.laps === 1 ? "lap" : "laps"}), ${age}`;
}

// ── Lap-by-lap positions (/positions) ───────────────────────────────────

/**
 * One series per driver: `{ lap, position }` points sorted by lap (lap 0 is
 * the grid when published). Duplicate laps keep the first value; invalid
 * rows are dropped; missing laps stay missing.
 */
export function buildPositionSeries(data, results = []) {
  const { availability, reason } = availabilityOf(data);
  const drivers = driversOf(data).map((driver) => {
    const result = resultFor(results, driver);
    const seen = new Set();
    const points = (Array.isArray(driver.positions) ? driver.positions : [])
      .filter((point) => isInt(point?.lap) && point.lap >= 0 && isInt(point?.position) && point.position >= 1 && point.position <= 40)
      .sort((a, b) => a.lap - b.lap)
      .filter((point) => (seen.has(point.lap) ? false : (seen.add(point.lap), true)))
      .map((point) => ({ lap: point.lap, position: point.position }));
    const finish = isInt(driver.finish) ? driver.finish : isInt(result?.position) ? result.position : null;
    const grid = isInt(driver.grid) && driver.grid > 0 ? driver.grid : isInt(result?.grid) && result.grid > 0 ? result.grid : null;
    return {
      driverId: isInt(driver.driver_id) ? driver.driver_id : null,
      code: text(driver.driver_code)?.toUpperCase() ?? "—",
      name: fullName(driver),
      team: text(driver.team_name) ?? text(result?.team_name) ?? "",
      grid,
      finish,
      points,
    };
  }).filter((driver) => driver.points.length > 0).sort(byFinish);
  const raceLaps = isInt(data?.race_laps) && data.race_laps > 0 ? data.race_laps : null;
  const maxLap = Math.max(raceLaps ?? 0, ...drivers.flatMap((driver) => driver.points.map((point) => point.lap)), 1);
  const maxPosition = Math.max(drivers.length, ...drivers.flatMap((driver) => driver.points.map((point) => point.position)), 1);
  return { availability, reason, method: text(data?.method), raceLaps, maxLap, maxPosition, drivers };
}

/** Position of every driver at `lap`, best first; drivers without a value at that lap are left out. */
export function orderAtLap(series, lap) {
  return (series?.drivers ?? [])
    .map((driver) => ({ driver, position: driver.points.find((point) => point.lap === lap)?.position ?? null }))
    .filter((entry) => entry.position != null)
    .sort((a, b) => a.position - b.position);
}

// ── Biggest climb ───────────────────────────────────────────────────────

/**
 * Largest recovery of the race: for each classified driver, the lowest
 * position held from the start (grid, lap 0, included) to the flag, minus the
 * finishing position. Computed from lap-by-lap positions when they are
 * published; otherwise falls back to grid → finish from the official
 * classification (same rule as the "Biggest gain" figure), and says so.
 *
 * @returns {{ state: "ok", value: string, detail: string, basis: "positions"|"grid", code?: string|null } | { state: "unavailable", reason: string }}
 */
export function biggestClimbFigure(positionsData, results = []) {
  const series = positionsData ? buildPositionSeries(positionsData, results) : null;
  const usable = series && series.availability !== "unavailable"
    ? series.drivers.filter((driver) => driver.finish != null && driver.points.some((point) => point.lap >= 1))
    : [];
  if (usable.length) {
    const climbs = usable.map((driver) => {
      const start = driver.points.find((point) => point.lap === 0)?.position ?? driver.grid;
      const running = driver.points.filter((point) => point.lap >= 1);
      const worst = running.reduce((low, point) => (point.position > low.position ? point : low), running[0]);
      const lowest = start != null && start >= worst.position ? { position: start, lap: 0 } : worst;
      return { driver, lowest, climb: lowest.position - driver.finish };
    }).sort((a, b) => b.climb - a.climb || a.driver.finish - b.driver.finish);
    const best = climbs[0];
    if (best.climb <= 0) return { state: "ok", value: "0", detail: "No driver recovered a place during the race", basis: "positions" };
    const tied = climbs.filter((entry) => entry.climb === best.climb);
    if (tied.length > 1) {
      return { state: "ok", value: `+${best.climb}`, detail: `Tied: ${naturalList(tied.map((entry) => entry.driver.name))}`, basis: "positions" };
    }
    const from = best.lowest.lap === 0 ? `P${best.lowest.position} on the grid` : `P${best.lowest.position} on lap ${best.lowest.lap}`;
    return { state: "ok", value: `+${best.climb}`, detail: `${best.driver.name}, ${from} to P${best.driver.finish}`, basis: "positions", code: best.driver.code };
  }

  const gains = rankPositionGains(results);
  const top = gains[0];
  if (!top) return { state: "unavailable", reason: "Lap-by-lap positions are not published and no classified result has a grid position." };
  if (top.gained <= 0) return { state: "ok", value: "0", detail: "No driver gained a place from the grid", basis: "grid" };
  const tied = gains.filter((row) => row.gained === top.gained);
  const who = tied.length > 1 ? `Tied: ${naturalList(tied.map(fullName))}` : `${fullName(top)}, P${top.grid} to P${top.position}`;
  return { state: "ok", value: `+${top.gained}`, detail: who, basis: "grid", code: tied.length > 1 ? null : top.driver_code ?? null };
}
