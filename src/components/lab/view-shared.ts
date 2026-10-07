import type { LabRaceResult } from "@/lib/lab-client";
import { driverKey } from "@/lib/lab-analytics";
import { formatShortLapTime } from "@/lib/lab-insights.mjs";

/**
 * Types and small helpers shared by the race views (LabViews, server
 * rendered) and the season views (SeasonViews, loaded in the browser).
 */

export interface LabDriverRef {
  id: number;
  code: string;
  name: string;
  team: string;
}

export interface LabRaceRef {
  round: number;
  label: string;
  sprintWeekend: boolean;
  completed: boolean;
}

export interface LabViewContext {
  season: number;
  round: number | null;
  /** "R16 · Malaysian Grand Prix" (official round when certified, never the internal key). */
  raceLabel: string | null;
  /** Short label used in export filenames ("R16" or race name). */
  roundSlug: string | null;
  races: readonly LabRaceRef[];
  results: readonly LabRaceResult[];
  standings: readonly {
    driver_id: number;
    driver_code: string;
    first_name: string;
    last_name: string;
    team_name: string;
    points: number | null;
    position: number | null;
  }[];
  selectedDrivers: readonly LabDriverRef[];
  raceIsLoading: boolean;
}

export const LAP_THRESHOLD = 1.07;

export function scopeLine(parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}

export function teamByCode(results: readonly LabRaceResult[]): Map<string, string> {
  return new Map(results.map((result) => [driverKey(result.driver_code, result.first_name, result.last_name), result.team_name ?? ""]));
}

/** Second driver of a team is dashed so teammates stay distinguishable. */
export function dashTeammates<T extends { team: string }>(items: readonly T[]): (T & { dashed: boolean })[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const dashed = seen.has(item.team);
    seen.add(item.team);
    return { ...item, dashed };
  });
}

export function shortLapTime(ms: number): string {
  return formatShortLapTime(ms) ?? "—";
}

export const tableHead = "border-b border-white/[0.08] text-[12px] font-medium text-white/[0.70]";
export const tableCell = "px-3 py-2 font-mono text-[12px] tabular-nums text-white/[0.84]";
