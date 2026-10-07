import type { APICalendarRace } from "./api-types";

const MINUTE = 60_000;

/** The weekend is defined in UTC, independent of the visitor's time zone. */
export function raceWeekendWindow(race: Pick<APICalendarRace, "date" | "is_sprint"> | null | undefined): { start: number; end: number } | null {
  if (!race || !/^\d{4}-\d{2}-\d{2}$/.test(race.date)) return null;
  const raceDay = Date.parse(`${race.date}T00:00:00Z`);
  if (!Number.isFinite(raceDay) || new Date(raceDay).toISOString().slice(0, 10) !== race.date) return null;
  const day = new Date(raceDay).getUTCDay();
  // Formula 1 races ordinarily run on Sunday. The calendar's date remains
  // authoritative for an exceptional Saturday race; sprint weekends use the
  // same Friday-to-Monday window because their first session is on Friday.
  const fridayOffset = (day - 5 + 7) % 7;
  return { start: raceDay - fridayOffset * 24 * 60 * MINUTE, end: raceDay + (8 - day) % 7 * 24 * 60 * MINUTE + 6 * 60 * MINUTE };
}

export function isRaceWeekend(race: Pick<APICalendarRace, "date" | "is_sprint"> | null | undefined, now: number): boolean {
  const window = raceWeekendWindow(race);
  return window != null && now >= window.start && now < window.end;
}

/** Server-side selection happens once per page regeneration. */
export function currentRaceWeekend<T extends APICalendarRace>(races: readonly T[]): T | null {
  const now = Date.now();
  return races.find((race) => isRaceWeekend(race, now)) ?? null;
}

/**
 * Successful responses follow the shortest API TTL, kept between one and five
 * minutes: a 5 s TTL must not hammer the API, and a one-hour TTL on a static
 * endpoint must not stall a live weekend. Failures back off to five minutes.
 */
export function nextLiveInterval(cacheTtls: readonly (number | null | undefined)[], failures: number): number {
  if (failures > 0) return Math.min(5 * MINUTE, MINUTE * 2 ** Math.min(failures, 3));
  const valid = cacheTtls.filter((ttl): ttl is number => typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0);
  if (!valid.length) return MINUTE;
  return Math.min(5 * MINUTE, Math.max(MINUTE, Math.min(...valid) * 1_000));
}

export function relativeUpdate(timestamp: string | null | undefined, now: number): string | null {
  if (!timestamp) return null;
  const then = Date.parse(timestamp);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.max(0, Math.floor((now - then) / MINUTE));
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `updated ${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return `updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}
