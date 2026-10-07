export type LabViewId =
  | "field"
  | "championship"
  | "constructors"
  | "report"
  | "pace"
  | "fastest"
  | "strategy"
  | "timeline"
  | "sessions"
  | "h2h"
  | "seasons"
  | "ask";

export type LabViewGroup = "Season" | "Race" | "Compare" | "Ask";

export interface LabViewDef {
  id: LabViewId;
  label: string;
  group: LabViewGroup;
  /** Element id of the view's region (deep links, focus, end-to-end tests). */
  anchor: string;
  /** Extra words for the ⌘K palette. */
  keywords: string;
}

interface RaceLike {
  round: number;
  name: string;
  date: string;
  time?: string | null;
  status?: string | null;
}

export declare const LAB_VIEW_GROUPS: readonly LabViewGroup[];
export declare const LAB_VIEWS: readonly LabViewDef[];
export declare function isLabViewId(value: unknown): value is LabViewId;
export declare function defaultLabView(hasRace: boolean): LabViewId;
export declare function labViewDef(id: LabViewId): LabViewDef;
export declare function parseLabView(value: string | null | undefined, hasRace: boolean): LabViewId;
export declare function formatCountdown(ms: number): string;
export declare function raceStartMs(race: Pick<RaceLike, "date" | "time"> | null | undefined): number | null;
export declare function nextRaceAfter<T extends RaceLike>(races: readonly T[], now: number): T | null;
export declare function formatRaceDay(race: Pick<RaceLike, "date"> | null | undefined): string | null;
