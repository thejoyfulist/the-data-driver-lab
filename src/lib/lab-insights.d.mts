export type KeyFigure =
  | { state: "ok"; value: string; detail: string; code?: string | null }
  | { state: "unavailable"; reason: string };

interface ResultLike {
  position?: number | null;
  grid?: number | null;
  laps?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  driver_code?: string | null;
  team_name?: string | null;
}

interface FastestLapLike {
  time_ms?: number | null;
  time_formatted?: string | null;
  lap?: number | null;
  last_name?: string | null;
  driver_code?: string | null;
}

interface StandingLike {
  position?: number | null;
  points?: number | null;
  wins?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  driver_code?: string | null;
}

interface ConstructorLike {
  position?: number | null;
  points?: number | null;
  team_name?: string | null;
}

export declare function formatLapTime(ms: number | null | undefined): string | null;
export declare function raceLaps(results: readonly ResultLike[] | null | undefined): number | null;
export declare function winnerFigure(results: readonly ResultLike[] | null | undefined): KeyFigure;
export declare function biggestGainFigure(results: readonly ResultLike[] | null | undefined): KeyFigure;
export declare function fastestLapFigure(laps: readonly FastestLapLike[] | null | undefined): KeyFigure;
export declare function neutralisationFigure(bands: readonly { type?: string | null }[] | null | undefined): KeyFigure;
export declare function standingsInsights(standings: readonly StandingLike[] | null | undefined): string[];
export declare function raceInsights(results: readonly ResultLike[] | null | undefined): string[];
export declare function constructorInsights(rows: readonly ConstructorLike[] | null | undefined): string[];
export declare function comparisonInsights(selected: readonly StandingLike[] | null | undefined): string[];
