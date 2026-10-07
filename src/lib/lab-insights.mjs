/**
 * Deterministic figures and sentences for the Data Lab race report and the
 * inspector's "What stands out". Every value is read or computed from API
 * rows passed in; when a value cannot be computed the function says so
 * (`state: "unavailable"` or an empty list) instead of guessing.
 */

import { rankPositionGains } from "./lab-grounded-queries.mjs";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

function fullName(row) {
  const name = `${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim();
  return name || row?.driver_code || "Unnamed driver";
}

function formatPoints(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function naturalList(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * The one lap-time format of the Lab: "1:31.130" (or "58.123s" under a
 * minute), computed from milliseconds in integers so a time never shows
 * 60 seconds or 1000 milliseconds. Null when the time is missing or not
 * positive. The API's `time_formatted` is never displayed or exported.
 */
export function formatLapTime(ms) {
  if (!isNumber(ms) || ms <= 0) return null;
  const total = Math.round(ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = String(total % 1000).padStart(3, "0");
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}.${millis}` : `${seconds}.${millis}s`;
}

/** Axis form of a lap time, to the tenth: "1:31.1" (or "58.1s"); rounding carries into the minute. */
export function formatShortLapTime(ms) {
  if (!isNumber(ms) || ms <= 0) return null;
  const tenths = Math.round(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}.${tenth}` : `${seconds}.${tenth}s`;
}

/** Race distance: the most laps completed by any classified driver. */
export function raceLaps(results) {
  const laps = (Array.isArray(results) ? results : []).map((row) => row?.laps).filter(isNumber);
  return laps.length ? Math.max(...laps) : null;
}

// ── Key figures (race report) ──────────────────────────────────────────

export function winnerFigure(results) {
  const winner = (Array.isArray(results) ? results : []).find((row) => row?.position === 1);
  if (!winner) return { state: "unavailable", reason: "No classified winner is published for this race." };
  const parts = [winner.team_name || null, isNumber(winner.grid) && winner.grid > 0 ? `from P${winner.grid} on the grid` : null].filter(Boolean);
  return { state: "ok", value: fullName(winner), detail: parts.join(" · ") || "Team not published", code: winner.driver_code ?? null };
}

/** Same rule as the "Who gained the most from grid to finish?" answer. */
export function biggestGainFigure(results) {
  const gains = rankPositionGains(results);
  const best = gains[0];
  if (!best) return { state: "unavailable", reason: "No classified result with a grid position is published." };
  if (best.gained <= 0) return { state: "ok", value: "0", detail: "No driver gained a place from the grid" };
  const tied = gains.filter((row) => row.gained === best.gained);
  if (tied.length > 1) {
    return { state: "ok", value: `+${best.gained}`, detail: `Tied: ${naturalList(tied.map(fullName))}` };
  }
  return { state: "ok", value: `+${best.gained}`, detail: `${fullName(best)}, P${best.grid} to P${best.position}` };
}

/** Fastest lap of the race from the published per-driver fastest laps. */
export function fastestLapFigure(laps) {
  const timed = (Array.isArray(laps) ? laps : []).filter((lap) => isNumber(lap?.time_ms) && lap.time_ms > 0);
  if (timed.length === 0) return { state: "unavailable", reason: "No timed fastest lap is published for this race." };
  const best = [...timed].sort((a, b) => a.time_ms - b.time_ms)[0];
  const value = formatLapTime(best.time_ms);
  const who = best.last_name || best.driver_code || "Driver not published";
  return { state: "ok", value, detail: `${who} · ${isNumber(best.lap) ? `lap ${best.lap}` : "lap not published"}`, code: best.driver_code ?? null };
}

/** Safety-car and VSC periods, from bands built by buildNeutralisationBands. */
export function neutralisationFigure(bands) {
  const list = Array.isArray(bands) ? bands : [];
  if (list.length === 0) return { state: "ok", value: "0", detail: "No safety car or VSC published" };
  const vsc = list.filter((band) => band?.type === "VSC").length;
  const sc = list.length - vsc;
  const parts = [sc ? plural(sc, "safety car", "safety cars") : null, vsc ? plural(vsc, "VSC", "VSCs") : null].filter(Boolean);
  return { state: "ok", value: String(list.length), detail: parts.join(" · ") };
}

// ── What stands out ─────────────────────────────────────────────────────

function rankedStandings(standings) {
  return (Array.isArray(standings) ? standings : [])
    .filter((row) => isNumber(row?.points))
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || b.points - a.points);
}

/** Leader's margin and level-on-points pairs near the top of the drivers' table. */
export function standingsInsights(standings) {
  const rows = rankedStandings(standings);
  if (rows.length < 2) return [];
  const [leader, second] = rows;
  const sentences = [];
  const margin = leader.points - second.points;
  const wins = isNumber(leader.wins) ? ` with ${plural(leader.wins, "win", "wins")}` : "";
  if (margin > 0) {
    sentences.push(`${fullName(leader)} leads ${fullName(second)} by ${formatPoints(margin)} ${margin === 1 ? "point" : "points"}${wins}.`);
  } else {
    sentences.push(`${fullName(leader)} and ${fullName(second)} are level on ${formatPoints(leader.points)} points at the top.`);
  }
  const top = rows.slice(margin > 0 ? 1 : 2, 10);
  for (let index = 0; index < top.length; index += 1) {
    const group = top.filter((row) => row.points === top[index].points);
    if (group.length > 1 && group[0] === top[index]) {
      sentences.push(`${naturalList(group.map(fullName))} are level on ${formatPoints(top[index].points)} points.`);
      break;
    }
  }
  return sentences;
}

/** Winner's grid slot and the biggest grid-to-finish gain. */
export function raceInsights(results) {
  const sentences = [];
  const winner = (Array.isArray(results) ? results : []).find((row) => row?.position === 1);
  if (winner) {
    sentences.push(isNumber(winner.grid) && winner.grid > 0
      ? `${fullName(winner)} won from P${winner.grid} on the grid.`
      : `${fullName(winner)} won; the starting position is not published.`);
  }
  const gains = rankPositionGains(results);
  const best = gains[0];
  if (best && best.gained > 0) {
    const tied = gains.filter((row) => row.gained === best.gained);
    sentences.push(tied.length > 1
      ? `${naturalList(tied.map(fullName))} gained the most places: ${best.gained} each.`
      : `${fullName(best)} gained the most places: P${best.grid} to P${best.position} (+${best.gained}).`);
  }
  return sentences;
}

/** Leader's margin in the constructors' table. */
export function constructorInsights(rows) {
  const ranked = (Array.isArray(rows) ? rows : [])
    .filter((row) => isNumber(row?.points) && row?.team_name)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || b.points - a.points);
  if (ranked.length < 2) return [];
  const [leader, second] = ranked;
  const margin = leader.points - second.points;
  return [margin > 0
    ? `${leader.team_name} leads ${second.team_name} by ${formatPoints(margin)} ${margin === 1 ? "point" : "points"}.`
    : `${leader.team_name} and ${second.team_name} are level on ${formatPoints(leader.points)} points.`];
}

/** Points between the first selected driver and each other selected driver. */
export function comparisonInsights(selected) {
  const rows = (Array.isArray(selected) ? selected : []).filter((row) => isNumber(row?.points));
  if (rows.length < 2) return [];
  const [first, ...others] = rows;
  return others.slice(0, 3).map((other) => {
    const gap = first.points - other.points;
    if (gap === 0) return `${fullName(first)} and ${fullName(other)} are level on ${formatPoints(first.points)} points.`;
    const [ahead, behind] = gap > 0 ? [first, other] : [other, first];
    const margin = Math.abs(gap);
    return `${fullName(ahead)} is ${formatPoints(margin)} ${margin === 1 ? "point" : "points"} ahead of ${fullName(behind)}.`;
  });
}
