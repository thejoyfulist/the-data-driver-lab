export type TyreCompoundId = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" | "UNKNOWN";

export interface TyreCompound {
  id: TyreCompoundId;
  letter: string;
  label: string;
  fill: string;
  text: string;
  pattern: "solid" | "diagonal" | "crosshatch" | "horizontal" | "vertical" | "dotted";
}

/** `/v1/f1/races/{year}/{round}/stints` (lot H contract). */
export interface LabStintsPayload {
  availability?: "complete" | "partial" | "unavailable" | string | null;
  reason?: string | null;
  race_laps?: number | null;
  drivers?: {
    driver_id?: number | null;
    driver_code?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    team_name?: string | null;
    stints?: {
      stint_number?: number | null;
      compound?: string | null;
      start_lap?: number | null;
      end_lap?: number | null;
      laps?: number | null;
      tyre_age_at_start?: number | null;
    }[] | null;
  }[] | null;
}

/** `/v1/f1/races/{year}/{round}/positions` (lot H contract). */
export interface LabPositionsPayload {
  availability?: "complete" | "partial" | "unavailable" | string | null;
  reason?: string | null;
  method?: string | null;
  race_laps?: number | null;
  drivers?: {
    driver_id?: number | null;
    driver_code?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    team_name?: string | null;
    grid?: number | null;
    finish?: number | null;
    positions?: { lap?: number | null; position?: number | null }[] | null;
  }[] | null;
}

interface ResultLike {
  driver_id?: number | null;
  driver_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  team_name?: string | null;
  position?: number | null;
  grid?: number | null;
  laps?: number | null;
}

interface PitStopLike {
  driver_code?: string | null;
  lap?: number | null;
  duration_ms?: number | null;
}

export interface TyreStint {
  number: number;
  compound: TyreCompoundId;
  start: number;
  end: number;
  laps: number;
  ageAtStart: number | null;
}

export interface TyreStrategyRow {
  driverId: number | null;
  code: string;
  name: string;
  team: string;
  finish: number | null;
  stints: TyreStint[];
  /** Official stops (`derived: false`) and stint changes the official summary does not list (`derived: true`). */
  stops: { lap: number; durationMs: number | null; derived: boolean }[];
  /** False when /pitstops is empty or unavailable; zero official stops is then unknown. */
  pitSummaryPublished: boolean;
  /** Official top-10 row whose stints are not published. */
  missing?: boolean;
}

export interface TyreStrategy {
  availability: string | null;
  reason: string | null;
  raceLaps: number | null;
  maxLap: number;
  pitSummaryPublished: boolean;
  rows: TyreStrategyRow[];
}

export interface PositionDriver {
  driverId: number | null;
  code: string;
  name: string;
  team: string;
  grid: number | null;
  finish: number | null;
  points: { lap: number; position: number }[];
}

export interface PositionSeries {
  availability: string | null;
  reason: string | null;
  method: string | null;
  raceLaps: number | null;
  maxLap: number;
  maxPosition: number;
  drivers: PositionDriver[];
}

export type ClimbFigure =
  | { state: "ok"; value: string; detail: string; basis: "positions" | "positions-partial" | "grid"; scope: string; code?: string | null }
  | { state: "unavailable"; reason: string };

export declare const TYRE_COMPOUNDS: Record<TyreCompoundId, TyreCompound>;
export declare const COMPOUND_ORDER: readonly TyreCompoundId[];
export declare function normaliseCompound(value: unknown): TyreCompoundId;
export declare function buildTyreStrategy(data: LabStintsPayload | null | undefined, results?: readonly ResultLike[], pitStops?: readonly PitStopLike[]): TyreStrategy;
export declare function officialStops(row: Pick<TyreStrategyRow, "stops"> | null | undefined): TyreStrategyRow["stops"];
export declare function stintChangesOutsideSummary(row: Pick<TyreStrategyRow, "stops"> | null | undefined): TyreStrategyRow["stops"];
export declare function topFinisherStrategy(strategy: Pick<TyreStrategy, "rows"> | null | undefined, results?: readonly ResultLike[], count?: number): { rows: TyreStrategyRow[]; missing: TyreStrategyRow[] };
export declare function compoundSequence(row: Pick<TyreStrategyRow, "stints"> | null | undefined): string;
export declare function describeStint(stint: TyreStint): string;
export declare function buildPositionSeries(data: LabPositionsPayload | null | undefined, results?: readonly ResultLike[]): PositionSeries;
export declare function orderAtLap(series: Pick<PositionSeries, "drivers"> | null | undefined, lap: number): { driver: PositionDriver; position: number }[];
export declare function biggestClimbFigure(positionsData: LabPositionsPayload | null | undefined, results?: readonly ResultLike[]): ClimbFigure;
