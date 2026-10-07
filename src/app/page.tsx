import type { Metadata } from "next";
import { fetchAPI, fetchAPIWithMeta } from "@/lib/api-client";
import { sortRacesChronologically } from "@/lib/site-display.mjs";
import type {
  APICalendarRace,
  APIRacePredictions,
} from "@/lib/api-types";
import type { LabSeed } from "@/components/lab/useLabResource";
import { LIVE_SEASON, SITE_URL } from "@/lib/site";
import LabPageClient from "./LabPageClient";
import { currentRaceWeekend } from "@/lib/lab-live-policy";

export const metadata: Metadata = {
  title: "Data Lab — Explore Formula 1 data",
  description:
    "Explore, compare and question live Formula 1 race data with the open-source Data Lab from The Data Driver.",
  // The hosted reference instance lives on the public website.
  alternates: { canonical: `${SITE_URL}/lab` },
};

interface LabStanding {
  position: number;
  driver_id: number;
  driver_code: string;
  first_name: string;
  last_name: string;
  team_name: string;
  points: number;
  wins: number;
}

interface LabResult {
  position: number;
  driver_id: number;
  driver_code: string;
  first_name: string;
  last_name: string;
  team_name: string;
  grid: number | null;
  laps: number | null;
  status: string;
  points: number;
}

interface LabPayload<T> {
  data: T;
  timestamp: string | null;
}

interface IngestionReadiness {
  ready: boolean;
  status: string;
  projection: {
    status: string;
    projected_at: string | null;
    cache_invalidated_at: string | null;
  };
  datasets: Array<{
    dataset: string;
    required: boolean;
    status: string;
    reason: string | null;
  }>;
}

// The circuits catalogue is an existing read-only API surface. Keep this
// presentation-local shape until the shared API types cover it.
interface LabCircuit {
  id: number;
  name: string;
  country: string;
  city: string;
  length_km: number | null;
  turns: number | null;
}

async function fetchLabEndpoint<T>(endpoint: string): Promise<T | null> {
  return fetchAPI<T>(endpoint);
}

/**
 * Server-render the selected race's views (pace, strategy, fastest laps,
 * timeline) so the default race reads without JavaScript. Keys are the exact
 * API paths the client views read; a failed fetch is left out and retried by
 * the browser. Season-wide views (championship progression = one request per
 * completed round, constructors, head-to-head) load in the browser on
 * demand, which keeps an ISR regeneration to 4 + 3 + at most 10 requests.
 */
async function buildInitialSeed(
  season: number,
  round: number | null,
  topDriverIds: number[],
): Promise<LabSeed> {
  if (round == null) return {};
  const endpoints = [
    `/v1/f1/races/${season}/${round}/fastest-laps`,
    `/v1/f1/races/${season}/${round}/pitstops`,
    `/v1/f1/races/${season}/${round}/stints`,
    `/v1/f1/races/${season}/${round}/positions`,
    `/v1/f1/races/${season}/${round}/safety-cars`,
    `/v1/f1/races/${season}/${round}/incidents`,
    `/v1/f1/races/${season}/${round}/weather`,
    ...topDriverIds.map((driverId) => `/v1/f1/races/${season}/${round}/laps/${driverId}`),
  ];
  const payloads = await Promise.all(endpoints.map((endpoint) => fetchAPIWithMeta<unknown>(endpoint)));
  return Object.fromEntries(
    endpoints.flatMap((endpoint, index) => {
      const payload = payloads[index];
      return payload ? [[endpoint, { data: payload.data, timestamp: payload.meta?.timestamp ?? null, meta: payload.meta ?? null }]] : [];
    }),
  );
}

export default async function LabPage() {
  const [calendar, nextRace, standings, circuits] = await Promise.all([
    fetchLabEndpoint<APICalendarRace[]>(`/v1/f1/calendar/${LIVE_SEASON}`),
    fetchLabEndpoint<APICalendarRace>("/v1/f1/calendar/next"),
    fetchLabEndpoint<LabStanding[]>(`/v1/f1/standings/drivers/${LIVE_SEASON}`),
    fetchLabEndpoint<LabCircuit[]>("/v1/f1/circuits"),
  ]);

  // Date order: internal round keys are not chronological (Malaysia is 25).
  const races = sortRacesChronologically(calendar);
  // Default to the most recently completed round, not calendar/next: right
  // after a race weekend the next round has no results yet, and defaulting
  // to it made the just-finished race look missing from the Lab even though
  // it's fully in the selector and fetchable. Fall back to the next race
  // only when the season hasn't produced a completed round yet.
  const lastCompletedRound = [...races]
    .reverse()
    .find((race) => race.status === "completed")?.round;
  const weekendRace = currentRaceWeekend(races);
  const initialRound = weekendRace?.round ?? lastCompletedRound ?? nextRace?.round ?? null;
  // Race payloads and the race views' seed are fetched in parallel.
  const [[resultPayload, predictionPayload, ingestionReadiness], initialSeed] = await Promise.all([
    initialRound
      ? Promise.all([
          fetchAPIWithMeta<LabResult[]>(`/v1/f1/races/${LIVE_SEASON}/${initialRound}/results`).then((payload) => payload && ({ data: payload.data, timestamp: payload.meta.timestamp })),
          fetchAPIWithMeta<APIRacePredictions | null>(`/v1/f1/predictions/race/${LIVE_SEASON}/${initialRound}`).then((payload) => payload && ({ data: payload.data, timestamp: payload.meta.timestamp })),
          fetchAPI<IngestionReadiness>(`/v1/f1/races/${LIVE_SEASON}/${initialRound}/ingestion-readiness`),
        ])
      : Promise.resolve([null, null, null] as const),
    buildInitialSeed(
      LIVE_SEASON,
      initialRound,
      (standings ?? []).slice(0, 3).map((driver) => driver.driver_id),
    ),
  ]);

  return (
    <LabPageClient
      calendar={races}
      nextRace={nextRace}
      circuits={circuits ?? []}
      initialSeason={LIVE_SEASON}
      initialRound={initialRound}
      initialStandings={standings ?? []}
      initialResults={resultPayload?.data ?? []}
      initialPredictions={predictionPayload?.data ?? null}
      initialSourceTimestamp={resultPayload?.timestamp ?? predictionPayload?.timestamp ?? null}
      initialIngestionReadiness={ingestionReadiness}
      initialSeasonError={calendar == null || standings == null}
      initialRaceError={initialRound != null && resultPayload == null}
      initialSeed={initialSeed}
    />
  );
}
