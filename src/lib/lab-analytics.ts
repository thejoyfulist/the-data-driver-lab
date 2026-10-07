/**
 * Pure data shaping for the Data Lab views. No fetching, no React: each
 * function turns published API rows into chart-ready series and never
 * invents a value that the API did not publish.
 */

import type { LabLap, LabPitStop, LabRaceResult, LabSafetyCar, LabIncident } from "./lab-client";
import { isFiniteNumber } from "./lab-client";

export function driverKey(code: string | null | undefined, firstName?: string | null, lastName?: string | null): string {
  const clean = code?.trim().toUpperCase();
  if (clean) return clean;
  return `${firstName ?? ""} ${lastName ?? ""}`
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// ── Championship progression ───────────────────────────────────────────

export interface ProgressionRound {
  round: number;
  label: string;
  sprintWeekend: boolean;
}

export interface ProgressionDriver {
  key: string;
  code: string;
  name: string;
  team: string;
  /** Cumulative Grand Prix points after each round; null where the round's results are missing. */
  cumulative: (number | null)[];
  gpTotal: number;
  officialTotal: number | null;
}

export interface ProgressionStandingLike {
  driver_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  team_name?: string | null;
  points?: number | null;
  position?: number | null;
}

/**
 * Cumulative Grand Prix points per round. Race results carry Grand Prix
 * points only, so the official total (which includes sprint points) is kept
 * beside the curve instead of being blended into it.
 */
export function buildChampionshipProgression(
  rounds: readonly ProgressionRound[],
  resultsByRound: Readonly<Record<number, readonly LabRaceResult[] | undefined>>,
  standings: readonly ProgressionStandingLike[],
): { rounds: ProgressionRound[]; drivers: ProgressionDriver[]; missingRounds: ProgressionRound[] } {
  const covered = rounds.filter((round) => Array.isArray(resultsByRound[round.round]));
  const missingRounds = rounds.filter((round) => !Array.isArray(resultsByRound[round.round]));
  const drivers = new Map<string, ProgressionDriver>();

  const ensure = (code: string | null | undefined, first?: string | null, last?: string | null, team?: string | null) => {
    const key = driverKey(code, first, last);
    let driver = drivers.get(key);
    if (!driver) {
      driver = {
        key,
        code: code?.trim().toUpperCase() || key.slice(0, 3).toUpperCase(),
        name: `${first ?? ""} ${last ?? ""}`.trim() || key,
        team: team ?? "",
        cumulative: covered.map(() => null),
        gpTotal: 0,
        officialTotal: null,
      };
      drivers.set(key, driver);
    }
    if (team && !driver.team) driver.team = team;
    return driver;
  };

  for (const standing of standings) {
    const driver = ensure(standing.driver_code, standing.first_name, standing.last_name, standing.team_name);
    driver.officialTotal = isFiniteNumber(standing.points) ? standing.points : null;
    if (standing.team_name) driver.team = standing.team_name;
  }

  covered.forEach((round, index) => {
    const pointsThisRound = new Map<string, number>();
    for (const result of resultsByRound[round.round] ?? []) {
      const driver = ensure(result.driver_code, result.first_name, result.last_name, result.team_name);
      pointsThisRound.set(driver.key, isFiniteNumber(result.points) ? result.points : 0);
    }
    for (const driver of drivers.values()) {
      driver.gpTotal += pointsThisRound.get(driver.key) ?? 0;
      driver.cumulative[index] = driver.gpTotal;
    }
  });

  return {
    rounds: covered.slice(),
    drivers: Array.from(drivers.values()).sort(
      (a, b) => (b.officialTotal ?? b.gpTotal) - (a.officialTotal ?? a.gpTotal),
    ),
    missingRounds,
  };
}

// ── Lap pace ────────────────────────────────────────────────────────────

export interface PacePoint {
  lap: number;
  timeMs: number;
}

export interface PaceSeries {
  kept: PacePoint[];
  excluded: number;
  bestMs: number | null;
  /** Median of the laps kept (green-flag laps when the filter is on, every timed lap otherwise). */
  medianMs: number | null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface PaceExclusions {
  /** Laps to drop before the threshold applies (pit in/out laps, neutralised laps). */
  laps?: ReadonlySet<number>;
  /** Keep laps up to `threshold` × the driver's best lap (F1's 107% convention). */
  threshold?: number | null;
}

/**
 * Representative race pace: drops the standing-start lap, the laps listed
 * in `exclusions.laps` (pit in/out, safety car / VSC) and any lap slower than
 * `threshold` × the driver's best lap. Dropped laps become gaps (null) so the
 * line never joins laps that are not consecutive; their count is returned so
 * the view can state it.
 */
export function buildPaceSeries(laps: readonly LabLap[], exclusions: PaceExclusions = {}): PaceSeries {
  const threshold = exclusions.threshold === undefined ? 1.07 : exclusions.threshold;
  const timed = laps
    .filter((lap) => isFiniteNumber(lap.lap_number) && isFiniteNumber(lap.time_ms) && (lap.time_ms as number) > 0)
    .map((lap) => ({ lap: lap.lap_number as number, timeMs: lap.time_ms as number }))
    .sort((a, b) => a.lap - b.lap);
  const bestMs = timed.length ? Math.min(...timed.map((point) => point.timeMs)) : null;
  const kept = threshold == null || bestMs == null
    ? timed
    : timed.filter((point) => point.lap > 1 && !exclusions.laps?.has(point.lap) && point.timeMs <= bestMs * threshold);
  // The median describes the laps on the chart: an excluded safety-car lap
  // must not move the "green-flag" median.
  return { kept, excluded: timed.length - kept.length, bestMs, medianMs: median(kept.map((point) => point.timeMs)) };
}

/** Points for a line chart: one entry per lap, null where a lap was dropped. */
export function paceLinePoints(series: PaceSeries): { x: number; y: number | null }[] {
  if (series.kept.length === 0) return [];
  const byLap = new Map(series.kept.map((point) => [point.lap, point.timeMs]));
  const first = series.kept[0].lap;
  const last = series.kept[series.kept.length - 1].lap;
  return Array.from({ length: last - first + 1 }, (_, index) => ({ x: first + index, y: byLap.get(first + index) ?? null }));
}

// ── Fastest laps ─────────────────────────────────────────────────────────

export interface LapGapRow {
  timeMs: number;
  /** Gap to the fastest published time; computed from the times when the API omits it. */
  gapMs: number;
  /** True when the gap was computed here rather than published. */
  gapComputed: boolean;
}

/**
 * Gaps to the fastest lap. A missing `gap_ms` is derived from the published
 * lap times (never assumed to be zero); rows without a time are dropped.
 */
export function fastestLapGaps<T extends { time_ms?: number | null; gap_ms?: number | null }>(laps: readonly T[]): (T & LapGapRow)[] {
  const timed = laps.filter((lap): lap is T & { time_ms: number } => isFiniteNumber(lap.time_ms));
  if (timed.length === 0) return [];
  const fastest = Math.min(...timed.map((lap) => lap.time_ms));
  return timed.map((lap) => {
    const published = isFiniteNumber(lap.gap_ms) ? lap.gap_ms : null;
    return { ...lap, timeMs: lap.time_ms, gapMs: published ?? lap.time_ms - fastest, gapComputed: published == null };
  });
}

// ── Practice best laps ───────────────────────────────────────────────────

export interface PracticeSessionInput {
  session: string;
  /** "ready" | "empty" | "error" | "loading" (see useLabResource). */
  status: string;
  data: unknown;
  errorStatus?: number | null;
}

export interface PracticeBestRow {
  session: string;
  rank: number | null;
  driverCode: string;
  driver: string;
  bestMs: number;
  gapMs: number;
}

export interface PracticeBestSummary {
  rows: PracticeBestRow[];
  /** Sessions with a published classification. */
  published: string[];
  /** Sessions the API declared unpublished, with its reason when given. */
  unpublished: { session: string; reason: string | null }[];
  /** Sessions whose request failed: the table is then explicitly partial. */
  failed: { session: string; status: number | null }[];
}

/**
 * Merge the per-session best-lap classifications (`/practice/{FPn}/best`).
 * The API computes each minimum over every lap, so the result never depends
 * on which page of raw laps was read.
 */
export function buildPracticeBest(sessions: readonly PracticeSessionInput[]): PracticeBestSummary {
  const summary: PracticeBestSummary = { rows: [], published: [], unpublished: [], failed: [] };
  for (const input of sessions) {
    if (input.status === "loading") continue;
    if (input.status === "error") {
      summary.failed.push({ session: input.session, status: input.errorStatus ?? null });
      continue;
    }
    const data = (input.data ?? null) as { classification?: unknown; reason?: unknown } | null;
    const classification = Array.isArray(data?.classification) ? (data.classification as Record<string, unknown>[]) : [];
    const rows = classification.flatMap((row): PracticeBestRow[] => {
      const best = isFiniteNumber(row.best_ms) ? row.best_ms : isFiniteNumber(row.time_ms) ? row.time_ms : null;
      if (best == null) return [];
      const first = typeof row.first_name === "string" ? row.first_name : "";
      const last = typeof row.last_name === "string" ? row.last_name : "";
      const code = typeof row.driver_code === "string" ? row.driver_code.toUpperCase() : "";
      return [{ session: input.session, rank: isFiniteNumber(row.rank) ? row.rank : null, driverCode: code, driver: `${first} ${last}`.trim() || code, bestMs: best, gapMs: 0 }];
    });
    if (rows.length === 0) {
      summary.unpublished.push({ session: input.session, reason: typeof data?.reason === "string" && data.reason.trim() ? data.reason.trim() : null });
      continue;
    }
    const fastest = Math.min(...rows.map((row) => row.bestMs));
    rows.sort((a, b) => a.bestMs - b.bestMs).forEach((row, index) => {
      row.gapMs = row.bestMs - fastest;
      row.rank ??= index + 1;
    });
    summary.published.push(input.session);
    summary.rows.push(...rows);
  }
  return summary;
}

// ── Strategy (pit stops → stints) ──────────────────────────────────────

export interface StintPlan {
  key: string;
  code: string;
  name: string;
  team: string;
  finish: number | null;
  status: string | null;
  totalLaps: number | null;
  stops: { stop: number; lap: number; durationMs: number | null }[];
  stints: { index: number; start: number; end: number }[];
}

export function buildStintPlans(pitStops: readonly LabPitStop[], results: readonly LabRaceResult[]): StintPlan[] {
  const stopsByDriver = new Map<string, StintPlan["stops"]>();
  const namesByDriver = new Map<string, { code: string; name: string }>();
  for (const stop of pitStops) {
    if (!isFiniteNumber(stop.lap)) continue;
    const key = driverKey(stop.driver_code, stop.first_name, stop.last_name);
    const list = stopsByDriver.get(key) ?? [];
    list.push({ stop: isFiniteNumber(stop.stop) ? stop.stop : list.length + 1, lap: stop.lap, durationMs: isFiniteNumber(stop.duration_ms) ? stop.duration_ms : null });
    stopsByDriver.set(key, list);
    namesByDriver.set(key, {
      code: stop.driver_code?.toUpperCase() ?? key.slice(0, 3).toUpperCase(),
      name: `${stop.first_name ?? ""} ${stop.last_name ?? ""}`.trim(),
    });
  }

  const plans: StintPlan[] = [];
  const seen = new Set<string>();
  const sortedResults = [...results].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  for (const result of sortedResults) {
    const key = driverKey(result.driver_code, result.first_name, result.last_name);
    seen.add(key);
    plans.push(makePlan(key, {
      code: result.driver_code?.toUpperCase() ?? key.slice(0, 3).toUpperCase(),
      name: `${result.first_name ?? ""} ${result.last_name ?? ""}`.trim(),
    }, result, stopsByDriver.get(key) ?? []));
  }
  for (const [key, stops] of stopsByDriver) {
    if (seen.has(key)) continue;
    plans.push(makePlan(key, namesByDriver.get(key) ?? { code: key, name: key }, null, stops));
  }
  return plans;
}

function makePlan(
  key: string,
  identity: { code: string; name: string },
  result: LabRaceResult | null,
  rawStops: StintPlan["stops"],
): StintPlan {
  const stops = [...rawStops].sort((a, b) => a.lap - b.lap);
  const lastStopLap = stops.at(-1)?.lap ?? 0;
  const totalLaps = isFiniteNumber(result?.laps) ? (result?.laps as number) : null;
  const end = Math.max(totalLaps ?? lastStopLap, lastStopLap);
  const stints: StintPlan["stints"] = [];
  let start = 1;
  stops.forEach((stop, index) => {
    stints.push({ index: index + 1, start, end: stop.lap });
    start = stop.lap + 1;
  });
  if (end >= start) stints.push({ index: stints.length + 1, start, end });
  return {
    key,
    code: identity.code,
    name: identity.name,
    team: result?.team_name ?? "",
    finish: isFiniteNumber(result?.position) ? (result?.position as number) : null,
    status: result?.status ?? null,
    totalLaps,
    stops,
    stints,
  };
}

// ── Race timeline ───────────────────────────────────────────────────────

export interface NeutralisationBand {
  type: string;
  start: number;
  end: number;
  endPublished: boolean;
}

export function buildNeutralisationBands(periods: readonly LabSafetyCar[], raceLaps: number | null): NeutralisationBand[] {
  return periods
    .filter((period) => isFiniteNumber(period.start_lap))
    .map((period) => {
      const start = period.start_lap as number;
      const endPublished = isFiniteNumber(period.end_lap);
      const end = endPublished ? Math.max(period.end_lap as number, start) : start;
      return { type: (period.type ?? "SC").toUpperCase(), start, end: raceLaps ? Math.min(end, raceLaps) : end, endPublished };
    })
    .sort((a, b) => a.start - b.start);
}

export interface TimelineIncident {
  lap: number | null;
  kind: string;
  label: string;
}

export function buildTimelineIncidents(incidents: readonly LabIncident[]): TimelineIncident[] {
  return incidents.map((incident) => {
    const kind = (incident.incident_type ?? incident.type ?? "incident").toString();
    const subject = incident.driver ? `${incident.driver}` : null;
    const description = incident.description ?? null;
    const label = [kind.toUpperCase().replaceAll("_", " "), subject, description && description !== "DNF" ? description : null]
      .filter(Boolean)
      .join(" · ");
    return { lap: isFiniteNumber(incident.lap) ? incident.lap : null, kind, label };
  });
}

/** Pit-stop count per lap (1-indexed), for the density strip on the race timeline. */
export function pitStopsPerLap(pitStops: readonly LabPitStop[], raceLaps: number): number[] {
  const counts = Array.from({ length: Math.max(raceLaps, 0) }, () => 0);
  for (const stop of pitStops) {
    if (isFiniteNumber(stop.lap) && stop.lap >= 1 && stop.lap <= raceLaps) counts[stop.lap - 1] += 1;
  }
  return counts;
}
