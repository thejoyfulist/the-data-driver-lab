/**
 * Data Lab client: typed payloads for the public endpoints the Lab reads,
 * defensive normalisers, and the export helpers shared by every Lab view.
 *
 * Every field coming from the API is optional or nullable here (rule 31):
 * a view renders "not published" rather than crashing when a field is absent.
 */

import { withTrustedOfficialRounds } from "./site-display.mjs";

/** Browser requests stay same-origin through the Next proxy (/api/f1/...). */
export const LAB_PROXY_BASE = "/api/f1";

/** Public origin shown to people copying a request; the proxy is an implementation detail. */
export const PUBLIC_API_ORIGIN = (process.env.NEXT_PUBLIC_TDD_API_BASE || "https://api.thedatadriver.app").replace(/\/+$/, "");

export interface LabSourceMeta {
  source?: string;
  source_url?: string | null;
  license?: string | null;
  license_url?: string | null;
  attribution?: string | null;
  adaptation_notice?: string | null;
  data_fetched_at?: string | null;
  timestamp?: string | null;
  cache_ttl?: number | null;
  total?: number | null;
}

export interface LabPayload<T> {
  data: T;
  timestamp: string | null;
  meta: LabSourceMeta | null;
}

export class LabAPIError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`API returned ${status}`);
    this.name = "LabAPIError";
    this.status = status;
  }
}

export async function fetchLab<T>(endpoint: string, timeoutMs = 8_000): Promise<LabPayload<T>> {
  const response = await fetch(`${LAB_PROXY_BASE}${endpoint}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new LabAPIError(response.status);
  const payload = await response.json();
  return {
    data: withTrustedOfficialRounds(payload?.data ?? payload, payload?.meta) as T,
    timestamp: payload?.meta?.timestamp ?? null,
    meta: payload?.meta ?? null,
  };
}

export function publicApiUrl(endpoint: string): string {
  return `${PUBLIC_API_ORIGIN}${endpoint}`;
}

// ── Endpoint shapes (all optional: the Lab never trusts a field to exist) ──

export interface LabLap {
  lap_number?: number | null;
  driver_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: number | null;
  time_ms?: number | null;
  time_formatted?: string | null;
}

export interface LabDriverLaps {
  year?: number;
  round?: number;
  driver_id?: string | number;
  laps?: LabLap[] | null;
}

export interface LabPitStop {
  stop?: number | null;
  lap?: number | null;
  duration_ms?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  driver_code?: string | null;
  source?: string | null;
}

export interface LabFastestLap {
  rank?: number | null;
  driver_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  lap?: number | null;
  time_ms?: number | null;
  time_formatted?: string | null;
  gap_ms?: number | null;
}

export interface LabFastestLaps {
  availability?: string | null;
  fastest_laps?: LabFastestLap[] | null;
}

/** One row of `/practice/{session}/best` (each driver's best timed lap). */
export interface LabPracticeBestRow {
  rank?: number | null;
  driver_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  best_ms?: number | null;
  /** Accepted as an alias of `best_ms`. */
  time_ms?: number | null;
  gap_ms?: number | null;
}

export interface LabPracticeBest {
  session?: string | null;
  classification?: LabPracticeBestRow[] | null;
  availability?: string | null;
  reason?: string | null;
}

/** One car telemetry sample. The API publishes `speed_kph`; `speed` is read as a legacy alias. */
export interface LabTelemetrySample {
  timestamp?: string | null;
  speed_kph?: number | null;
  speed?: number | null;
}

export interface LabTelemetry {
  driver_code?: string | null;
  samples?: LabTelemetrySample[] | null;
  availability?: string | null;
  reason?: string | null;
}

export function sampleSpeed(sample: LabTelemetrySample | null | undefined): number | null {
  if (isFiniteNumber(sample?.speed_kph)) return sample.speed_kph;
  if (isFiniteNumber(sample?.speed)) return sample.speed;
  return null;
}

export interface LabWeather {
  air_temp?: number | null;
  track_temp?: number | null;
  humidity?: number | null;
  wind_speed?: number | null;
  wind_direction?: number | null;
  rainfall?: boolean | number | null;
  timestamp?: string | null;
}

export interface LabSafetyCar {
  type?: string | null;
  start_lap?: number | null;
  end_lap?: number | null;
  reason?: string | null;
}

export interface LabIncident {
  type?: string | null;
  incident_type?: string | null;
  lap?: number | null;
  driver?: string | null;
  description?: string | null;
}

export interface LabConstructorStanding {
  position?: number | null;
  team_id?: number | null;
  team_name?: string | null;
  points?: number | null;
  wins?: number | null;
}

export interface LabHeadToHeadCount {
  driver1_wins?: number | null;
  driver2_wins?: number | null;
  total?: number | null;
}

export interface LabHeadToHead {
  driver1?: { id?: number; code?: string | null; first_name?: string | null; last_name?: string | null } | null;
  driver2?: { id?: number; code?: string | null; first_name?: string | null; last_name?: string | null } | null;
  race_h2h?: LabHeadToHeadCount | null;
  season_race_h2h?: LabHeadToHeadCount | null;
  quali_h2h?: LabHeadToHeadCount | null;
  prediction?: {
    round?: number | null;
    p_driver1_ahead?: number | null;
    driver1_expected_pos?: number | null;
    driver2_expected_pos?: number | null;
  } | null;
}

export interface LabRaceResult {
  position?: number | null;
  driver_id?: number;
  driver_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  team_name?: string | null;
  grid?: number | null;
  laps?: number | null;
  status?: string | null;
  points?: number | null;
}

/**
 * Optional datasets may answer `{ availability: "unavailable", reason }`
 * instead of rows (backend connectors lot). The reason is shown verbatim in
 * the empty state; it is never replaced by a guess.
 */
export interface LabAvailability {
  availability: string | null;
  reason: string | null;
}

export function readAvailabilityInfo(data: unknown): LabAvailability {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const { availability, reason } = data as { availability?: unknown; reason?: unknown };
    return {
      availability: typeof availability === "string" && availability.trim() ? availability : null,
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
    };
  }
  return { availability: null, reason: null };
}

/** True when the API explicitly says the dataset is not published. */
export function isDeclaredUnavailable(data: unknown): boolean {
  return readAvailabilityInfo(data).availability === "unavailable";
}

/** `availability` alone (kept for callers that only need the state). */
export function readAvailability(data: unknown): string | null {
  return readAvailabilityInfo(data).availability;
}

/**
 * Empty-state sentence for an unpublished dataset: the caller's sentence,
 * followed by the API's own reason when it gives one.
 */
export function unavailableDetail(data: unknown, fallback: string): string {
  const { availability, reason } = readAvailabilityInfo(data);
  const sentence = fallback.replace(/\.$/, "");
  if (reason) return `${sentence}. API reason: ${reason}`;
  if (availability && availability !== "completed") return `${sentence} (API availability: ${availability}).`;
  return `${sentence}.`;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ── Formatting ──────────────────────────────────────────────────────────

export function formatLapMs(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "Not published";
  const totalSeconds = value / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(3).padStart(6, "0");
  return minutes > 0 ? `${minutes}:${seconds}` : `${(value / 1000).toFixed(3)}s`;
}

export function formatUtcTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

/** Human source line for a payload envelope ("formula1.com", "OpenF1 · CC BY-NC-SA 4.0"). */
export function describeSource(meta: LabSourceMeta | null | undefined): string {
  if (!meta?.source) return "The Data Driver API";
  if (meta.source.startsWith("openf1.org")) {
    return `OpenF1 historical · ${meta.license ?? "CC BY-NC-SA 4.0"} · non-official enrichment`;
  }
  if (meta.source === "tdd") return "The Data Driver API";
  return meta.source;
}

// ── Export ──────────────────────────────────────────────────────────────

export type ExportRow = Record<string, string | number | boolean | null | undefined>;

// A spreadsheet runs a cell that starts with one of these characters as a
// formula, also after leading spaces; tab and carriage return are themselves
// formula triggers in some tools (OWASP "CSV injection").
const FORMULA_PREFIX = /^[\s]*[=+\-@]|^[\t\r]/;

/** CSV cell: text that a spreadsheet would execute is prefixed with ' (numbers are left as they are). */
export function csvCell(value: ExportRow[string]): string {
  if (value == null) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\n\r\t]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: readonly ExportRow[]): string {
  if (rows.length === 0) return "";
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    // Clipboard API refused (permissions / insecure context): fall through to
    // the selection-based copy below, and report failure if that fails too.
    console.warn("Clipboard API unavailable", error);
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

/** Download basename for a view ("tdd-fastest-laps-2026-r16"); the extension is added per format. */
export function exportBasename(view: string, season: number, roundLabel: string | null): string {
  const scope = roundLabel ? `${season}-${roundLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : String(season);
  return `tdd-${view}-${scope}`;
}
