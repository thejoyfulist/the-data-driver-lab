"use client";

import { useMemo, useState } from "react";
import {
  buildNeutralisationBands,
  buildPaceSeries,
  paceLinePoints,
  buildStintPlans,
  buildTimelineIncidents,
  driverKey,
  fastestLapGaps,
  pitStopsPerLap,
} from "@/lib/lab-analytics";
import {
  asArray,
  exportBasename,
  formatLapMs,
  isFiniteNumber,
  readAvailabilityInfo,
  unavailableDetail,
  type LabDriverLaps,
  type LabFastestLaps,
  type LabIncident,
  type LabPitStop,
  type LabSafetyCar,
  type LabWeather,
} from "@/lib/lab-client";
import { formatLapTime } from "@/lib/lab-insights.mjs";
import { readableTeamColor, teamColor } from "@/lib/team-colors";
import { LineChart, type LineSeries } from "./charts/LineChart";
import { RaceTimeline } from "./charts/RaceTimeline";
import { StintTimeline } from "./charts/StintTimeline";
import { TeamBars } from "./charts/TeamBars";
import { useLabResource, useLabResources, type LabResource } from "./useLabResource";
import { NotPublished, ViewCard, ViewSkeleton } from "./ViewCard";
import { useChartCursor } from "./charts/chart-utils";
import {
  dashTeammates,
  LAP_THRESHOLD,
  scopeLine,
  shortLapTime,
  tableCell,
  tableHead,
  teamByCode,
  type LabViewContext,
} from "./view-shared";

/**
 * Views of the selected race (pace, strategy, fastest laps, timeline). They
 * are rendered on the server from seeded payloads, so the default race reads
 * without JavaScript. Season-wide views live in SeasonViews and load in the
 * browser on demand.
 */

export type { LabDriverRef, LabRaceRef, LabViewContext } from "./view-shared";

// ── Lap pace ────────────────────────────────────────────────────────────

export function PaceView({ context }: { context: LabViewContext }) {
  const [, setLapCursor] = useChartCursor("lap");
  const [filtered, setFiltered] = useState(true);
  const drivers = context.selectedDrivers.slice(0, 4);
  const endpoints = context.round == null ? [] : drivers.map((driver) => `/v1/f1/races/${context.season}/${context.round}/laps/${driver.id}`);
  const resources = useLabResources<LabDriverLaps>(endpoints);
  const base = context.round == null ? null : `/v1/f1/races/${context.season}/${context.round}`;
  // Same cached payloads as the strategy and timeline views: used to drop
  // pit in/out laps and laps run behind the safety car or under VSC.
  const pitStops = useLabResource<LabPitStop[]>(base && `${base}/pitstops`);
  const safetyCars = useLabResource<LabSafetyCar[]>(base && `${base}/safety-cars`);
  const incidents = useLabResource<LabIncident[]>(base && `${base}/incidents`);
  const loading = endpoints.some((endpoint) => resources[endpoint]?.status === "loading");
  const raceLaps = Math.max(0, ...context.results.map((result) => (isFiniteNumber(result.laps) ? result.laps : 0)));
  const neutralised = new Set(
    buildNeutralisationBands(asArray<LabSafetyCar>(safetyCars.data), raceLaps || null).flatMap((band) =>
      Array.from({ length: band.end - band.start + 2 }, (_, index) => band.start + index),
    ),
  );
  const pitLapsByDriver = new Map<string, Set<number>>();
  for (const stop of asArray<LabPitStop>(pitStops.data)) {
    if (!isFiniteNumber(stop.lap)) continue;
    const key = driverKey(stop.driver_code, stop.first_name, stop.last_name);
    const set = pitLapsByDriver.get(key) ?? new Set<number>();
    set.add(stop.lap);
    set.add(stop.lap + 1);
    pitLapsByDriver.set(key, set);
  }

  const lines = dashTeammates(drivers).map((driver, index) => {
    const resource = resources[endpoints[index]];
    const laps = asArray<NonNullable<LabDriverLaps["laps"]>[number]>(resource?.data?.laps);
    const excludedLaps = new Set([...neutralised, ...(pitLapsByDriver.get(driverKey(driver.code)) ?? [])]);
    const pace = buildPaceSeries(laps, filtered ? { laps: excludedLaps, threshold: LAP_THRESHOLD } : { threshold: null });
    return { driver, resource, pace, dashed: driver.dashed };
  });
  const withData = lines.filter((line) => line.pace.kept.length > 0);
  const series: LineSeries[] = withData.map(({ driver, pace, dashed }) => ({
    id: String(driver.id),
    label: driver.code,
    name: driver.name,
    color: teamColor(driver.team),
    textColor: readableTeamColor(driver.team),
    dashed,
    points: paceLinePoints(pace),
  }));
  const excluded = lines.reduce((sum, line) => sum + line.pace.excluded, 0);
  const missingLines = lines.filter((line) => line.resource && line.resource.status !== "loading" && line.pace.kept.length === 0);
  const missing = missingLines.map((line) => line.driver.code);
  // The API's own reason (e.g. "No attributed race laps were found…"), once per distinct reason.
  const missingReasons = Array.from(new Set(missingLines.map((line) => readAvailabilityInfo(line.resource?.data).reason).filter((reason): reason is string => Boolean(reason))));
  const failed = missingLines.filter((line) => line.resource?.status === "error").map((line) => line.driver.code);
  const source = withData[0]?.resource?.payload?.meta;
  const exportRows = withData.flatMap(({ driver, pace }) =>
    pace.kept.map((point) => ({ season: context.season, race: context.raceLabel, driver_code: driver.code, driver: driver.name, team: driver.team, lap: point.lap, lap_time_ms: point.timeMs, lap_time: formatLapMs(point.timeMs) })),
  );

  return (
    <ViewCard
      id="lab-pace"
      title="Lap-by-lap pace"
      scope={scopeLine([
        context.raceLabel ?? `${context.season}`,
        `${drivers.length} selected ${drivers.length === 1 ? "driver" : "drivers"}`,
        filtered ? `green-flag laps within ${Math.round(LAP_THRESHOLD * 100)}% of each driver's best · ${excluded} excluded` : "all timed laps",
      ])}
      endpoints={endpoints}
      source={source}
      exportRows={exportRows}
      exportName={exportBasename("lap-pace", context.season, context.roundSlug)}
      actions={
        <button
          type="button"
          aria-pressed={filtered}
          onClick={() => setFiltered((value) => !value)}
          className="inline-flex min-h-11 items-center rounded-md border border-white/[0.10] px-3 text-[13px] lg:min-h-9 text-white/[0.78] hover:border-white/[0.22] hover:text-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70"
        >
          {filtered ? "Show all laps" : "Hide slow laps"}
        </button>
      }
      footnote="The filter drops lap 1, pit in/out laps, laps under a published safety car or VSC (plus the lap after), and laps slower than 107% of the driver's best; gaps stay gaps. Lap times are non-official OpenF1 enrichment where the source says so."
    >
      {context.round == null ? (
        <NotPublished title="No race selected" detail="Choose a race to read lap times." />
      ) : drivers.length === 0 ? (
        <NotPublished title="Select drivers to compare" detail="Pick up to four drivers in the field view (or with ⌘K) to draw their lap times." />
      ) : loading && withData.length === 0 ? (
        <ViewSkeleton label="Loading lap times" rows={6} />
      ) : series.length === 0 ? (
        <NotPublished
          title={failed.length === drivers.length ? "Lap times unavailable" : undefined}
          tone={failed.length === drivers.length ? "amber" : "neutral"}
          detail={failed.length === drivers.length
            ? "The lap-time endpoint did not answer for this race. Nothing is inferred."
            : `The API has no lap times for ${drivers.map((driver) => driver.code).join(", ")} in this race.${missingReasons.length ? ` API reason: ${missingReasons.join(" ")}` : ""}`}
          source="/laps"
        />
      ) : (
        <>
          <LineChart
            series={series}
            ariaLabel={`Lap times for ${series.map((line) => line.label).join(", ")}`}
            xLabel="Lap"
            yLabel="Lap time"
            invertY
            formatX={(value) => `L${value}`}
            formatY={shortLapTime}
            formatValue={formatLapMs}
            missingLabel={filtered ? "excluded" : "not timed"}
            syncGroup="lap"
          />
          {raceLaps > 0 && (
            <div className="mt-4 border-t border-white/[0.06] pt-4" onPointerLeave={() => setLapCursor(null)} data-pace-strip>
              <p className="mb-2 text-[13px] text-white/[0.70]">Same lap axis: neutralisations, pit stops and incidents. The cursor follows the chart.</p>
              <RaceTimeline
                raceLaps={raceLaps}
                bands={buildNeutralisationBands(asArray<LabSafetyCar>(safetyCars.data), raceLaps)}
                incidents={buildTimelineIncidents(asArray<LabIncident>(incidents.data).filter((incident) => incident.type !== "safety_car"))}
                pitDensity={pitStopsPerLap(asArray<LabPitStop>(pitStops.data), raceLaps)}
                unavailable={{
                  neutralised: timelineRowState(safetyCars, "Safety cars", "/safety-cars"),
                  incidents: timelineRowState(incidents, "Incidents", "/incidents"),
                  pits: timelineRowState(pitStops, "Pit stops", "/pitstops"),
                }}
                syncGroup="lap"
                compact
              />
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {withData.map(({ driver, pace }) => (
              <div key={driver.id} className="rounded-md border border-white/[0.06] px-3 py-2">
                <dt className="font-mono text-[12px]" style={{ color: readableTeamColor(driver.team) }}>{driver.code}</dt>
                <dd className="mt-1 text-[13px] text-white/[0.70]">Best <span className="font-mono tabular-nums text-light">{formatLapMs(pace.bestMs)}</span></dd>
                <dd className="text-[13px] text-white/[0.70]">{filtered ? "Green-flag median" : "Median, all laps"} <span className="font-mono tabular-nums text-white/[0.84]">{formatLapMs(pace.medianMs)}</span></dd>
              </div>
            ))}
          </dl>
          {missing.length > 0 && (
            <p className="mt-3 text-[13px] text-ambre">
              {failed.length ? `Lap times unavailable (request failed) for ${failed.join(", ")}. ` : ""}
              {missing.length > failed.length ? `No lap times published for ${missing.filter((code) => !failed.includes(code)).join(", ")}.` : ""}
              {missingReasons.length ? <span> API reason: {missingReasons.join(" ")}</span> : null}
            </p>
          )}
        </>
      )}
    </ViewCard>
  );
}

// ── Strategy ────────────────────────────────────────────────────────────

export function StrategyView({ context, variant }: { context: LabViewContext; variant?: "view" | "card" }) {
  const endpoint = context.round == null ? null : `/v1/f1/races/${context.season}/${context.round}/pitstops`;
  const resource = useLabResource<LabPitStop[]>(endpoint);
  const stops = asArray<LabPitStop>(resource.data);
  const plans = useMemo(() => buildStintPlans(stops, context.results), [stops, context.results]);
  const rows = plans
    .filter((plan) => plan.stints.length > 0)
    .map((plan) => ({ ...plan, color: teamColor(plan.team), textColor: readableTeamColor(plan.team) }));
  const maxLap = Math.max(...rows.map((row) => row.totalLaps ?? row.stints.at(-1)?.end ?? 0), 1);
  const exportRows = stops.map((stop) => ({
    season: context.season,
    race: context.raceLabel,
    driver_code: stop.driver_code,
    driver: `${stop.first_name ?? ""} ${stop.last_name ?? ""}`.trim(),
    stop: stop.stop,
    lap: stop.lap,
    pit_lane_ms: stop.duration_ms,
  }));
  const fastest = [...stops].filter((stop) => isFiniteNumber(stop.duration_ms)).sort((a, b) => (a.duration_ms as number) - (b.duration_ms as number))[0];

  return (
    <ViewCard
      id="lab-strategy"
      variant={variant}
      title="Pit stops and stints"
      scope={scopeLine([context.raceLabel ?? `${context.season}`, `${stops.length} stops`, `${rows.length} drivers`, "ordered by finishing position"])}
      endpoints={endpoint ? [endpoint] : []}
      source={resource.payload?.meta}
      exportRows={exportRows}
      exportName={exportBasename("pit-stops", context.season, context.roundSlug)}
      footnote={`Tyre compounds are not published by this endpoint, so stints are numbered rather than coloured by compound.${fastest ? ` Shortest pit-lane time: ${fastest.driver_code ?? ""} ${formatLapMs(fastest.duration_ms)} (lap ${fastest.lap}).` : ""}`}
      table={
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left">
            <thead><tr className={tableHead}><th scope="col" className="px-3 py-2">Driver</th><th scope="col" className="px-3 py-2">Stop</th><th scope="col" className="px-3 py-2">Lap</th><th scope="col" className="px-3 py-2">Pit lane</th></tr></thead>
            <tbody>
              {stops.map((stop, index) => (
                <tr key={`${stop.driver_code}-${stop.stop}-${index}`} className="border-b border-white/[0.04]">
                  <th scope="row" className="px-3 py-2 text-left text-[13px] font-normal text-white/[0.84]"><span className="font-mono text-[12px]">{stop.driver_code}</span> <span className="text-white/[0.70]">{stop.first_name} {stop.last_name}</span></th>
                  <td className={tableCell}>{stop.stop ?? "Not published"}</td>
                  <td className={tableCell}>{stop.lap ?? "Not published"}</td>
                  <td className={tableCell}>{formatLapMs(stop.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      {endpoint == null ? (
        <NotPublished title="No race selected" detail="Choose a race to read its pit stops." />
      ) : resource.status === "loading" || context.raceIsLoading ? (
        <ViewSkeleton label="Loading pit stops" rows={8} />
      ) : resource.status === "error" ? (
        <NotPublished title="Pit stops unavailable" detail="The pit-stop endpoint did not answer for this race. Nothing is inferred." source="/pitstops" tone="amber" />
      ) : stops.length === 0 ? (
        <NotPublished detail="The API has no pit-stop summary for this race yet." source="formula1.com pit-stop summary via /pitstops" />
      ) : (
        <StintTimeline rows={rows} maxLap={maxLap} />
      )}
    </ViewCard>
  );
}

// ── Fastest laps ────────────────────────────────────────────────────────

export function FastestLapsView({ context, variant, limit, onShowAll }: { context: LabViewContext; variant?: "view" | "card"; limit?: number; onShowAll?: () => void }) {
  const endpoint = context.round == null ? null : `/v1/f1/races/${context.season}/${context.round}/fastest-laps`;
  const resource = useLabResource<LabFastestLaps>(endpoint);
  // Gaps come from the published times when `gap_ms` is missing: an absent
  // gap is never drawn as a tie with the fastest lap.
  const laps = fastestLapGaps(asArray<NonNullable<LabFastestLaps["fastest_laps"]>[number]>(resource.data?.fastest_laps));
  const computedGaps = laps.filter((lap) => lap.gapComputed && lap.gapMs > 0).length;
  const teams = teamByCode(context.results);
  const selected = new Set(context.selectedDrivers.map((driver) => driver.code));
  const rows = laps.map((lap, index) => {
    const team = teams.get(driverKey(lap.driver_code, lap.first_name, lap.last_name)) ?? "";
    return {
      id: `${lap.driver_code ?? index}`,
      rank: lap.rank ?? index + 1,
      label: `${lap.last_name ?? lap.driver_code ?? "Driver"}`,
      sub: team || null,
      color: teamColor(team),
      textColor: readableTeamColor(team),
      value: lap.gapMs,
      display: formatLapMs(lap.time_ms),
      note: lap.gapMs === 0 ? `lap ${lap.lap ?? "—"}` : `+${(lap.gapMs / 1000).toFixed(3)}${variant === "card" ? "" : "s"}${lap.gapComputed ? " (from times)" : ""}`,
      selected: selected.size ? selected.has((lap.driver_code ?? "").toUpperCase()) : undefined,
    };
  });
  const exportRows = laps.map((lap) => ({ season: context.season, race: context.raceLabel, rank: lap.rank, driver_code: lap.driver_code, driver: `${lap.first_name ?? ""} ${lap.last_name ?? ""}`.trim(), lap: lap.lap, time_ms: lap.time_ms, time: formatLapTime(lap.time_ms), gap_ms: lap.gapMs, gap_source: lap.gapComputed ? "computed from lap times" : "published" }));

  return (
    <ViewCard
      id="lab-fastest"
      variant={variant}
      title="Fastest lap per driver"
      scope={scopeLine([variant === "card" ? null : context.raceLabel ?? `${context.season}`, limit && laps.length > limit ? `top ${limit} of ${laps.length} drivers` : `${laps.length} drivers`, "bar = gap to the fastest lap"])}
      endpoints={endpoint ? [endpoint] : []}
      source={resource.payload?.meta}
      exportRows={exportRows}
      exportName={exportBasename("fastest-laps", context.season, context.roundSlug)}
      footnote={computedGaps > 0 ? `${computedGaps} ${computedGaps === 1 ? "gap was" : "gaps were"} not published by the API and ${computedGaps === 1 ? "is" : "are"} computed from the published lap times, marked "from times".` : undefined}
    >
      {endpoint == null ? (
        <NotPublished title="No race selected" detail="Choose a race to rank its fastest laps." />
      ) : resource.status === "loading" ? (
        <ViewSkeleton label="Loading fastest laps" rows={8} />
      ) : resource.status === "error" ? (
        <NotPublished title="Fastest laps unavailable" detail="The fastest-lap endpoint did not answer for this race (it only serves completed races)." source="/fastest-laps" tone="amber" />
      ) : rows.length === 0 ? (
        <NotPublished detail={unavailableDetail(resource.data, "The API has no timed laps for this race.")} source="/fastest-laps" />
      ) : (
        <>
          <TeamBars rows={limit ? rows.slice(0, limit) : rows} compact={variant === "card"} />
          {limit && rows.length > limit && onShowAll && (
            <button type="button" onClick={onShowAll} className="mt-3 inline-flex min-h-11 items-center text-[13px] lg:min-h-9 text-white/[0.78] underline-offset-4 hover:text-light hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70">
              All {rows.length} drivers →
            </button>
          )}
        </>
      )}
    </ViewCard>
  );
}

// ── Race timeline (neutralisations, incidents, pit density, weather) ───

/**
 * Row message for a timeline dataset that could not be read, or that the API
 * declared unpublished with a reason. `null` means "read fine".
 */
function timelineRowState(resource: LabResource<unknown>, label: string, path: string): string | null {
  if (resource.status === "error") {
    return `${label} unavailable · ${path} did not answer${resource.errorStatus ? ` (HTTP ${resource.errorStatus})` : ""}`;
  }
  const { availability, reason } = readAvailabilityInfo(resource.data);
  if (availability === "unavailable") return `${label} not published${reason ? ` · ${reason}` : ""}`;
  return null;
}

function weatherSnapshot(data: unknown): LabWeather | null {
  if (Array.isArray(data)) return (data.at(-1) as LabWeather | undefined) ?? null;
  return data && typeof data === "object" ? (data as LabWeather) : null;
}

export function RaceTimelineView({ context, variant }: { context: LabViewContext; variant?: "view" | "card" }) {
  const base = context.round == null ? null : `/v1/f1/races/${context.season}/${context.round}`;
  const safetyCars = useLabResource<LabSafetyCar[]>(base && `${base}/safety-cars`);
  const incidents = useLabResource<LabIncident[]>(base && `${base}/incidents`);
  const pitStops = useLabResource<LabPitStop[]>(base && `${base}/pitstops`);
  const weather = useLabResource<LabWeather | LabWeather[]>(base && `${base}/weather`);
  const raceLaps = Math.max(0, ...context.results.map((result) => (isFiniteNumber(result.laps) ? result.laps : 0)));
  const bands = buildNeutralisationBands(asArray<LabSafetyCar>(safetyCars.data), raceLaps || null);
  const events = buildTimelineIncidents(asArray<LabIncident>(incidents.data).filter((incident) => incident.type !== "safety_car"));
  const density = pitStopsPerLap(asArray<LabPitStop>(pitStops.data), raceLaps);
  const snapshot = readAvailabilityInfo(weather.data).availability === "unavailable" ? null : weatherSnapshot(weather.data);
  const loading = [safetyCars, incidents, pitStops, weather].some((resource) => resource.status === "loading") || context.raceIsLoading;
  const rowStates = {
    neutralised: timelineRowState(safetyCars, "Safety cars", "/safety-cars"),
    incidents: timelineRowState(incidents, "Incidents", "/incidents"),
    pits: timelineRowState(pitStops, "Pit stops", "/pitstops"),
  };
  const weatherState = timelineRowState(weather, "Weather", "/weather");
  const retirements = events
    .filter((event) => /dnf|retire/i.test(event.kind))
    .map((event) => `${event.label.split(" · ").slice(1).join(" · ") || "Driver not published"}${event.lap != null ? ` (lap ${event.lap})` : " (lap not published)"}`);
  const allFailed = [safetyCars, incidents, pitStops, weather].every((resource) => resource.status === "error");
  const exportRows = [
    ...bands.map((band) => ({ season: context.season, race: context.raceLabel, kind: band.type, start_lap: band.start, end_lap: band.endPublished ? band.end : null, detail: band.endPublished ? null : "end lap not published" })),
    ...events.map((event) => ({ season: context.season, race: context.raceLabel, kind: event.kind, start_lap: event.lap, end_lap: event.lap, detail: event.label })),
  ];
  const weatherItems: [string, string | null][] = snapshot
    ? [
        ["Air", isFiniteNumber(snapshot.air_temp) ? `${snapshot.air_temp.toFixed(1)}°C` : null],
        ["Track", isFiniteNumber(snapshot.track_temp) ? `${snapshot.track_temp.toFixed(1)}°C` : null],
        ["Humidity", isFiniteNumber(snapshot.humidity) ? `${Math.round(snapshot.humidity)}%` : null],
        ["Wind", isFiniteNumber(snapshot.wind_speed) ? `${snapshot.wind_speed.toFixed(1)} m/s` : null],
        ["Rain", snapshot.rainfall == null ? null : snapshot.rainfall ? "Yes" : "No"],
      ]
    : [];

  return (
    <ViewCard
      id="lab-timeline"
      variant={variant}
      title={variant === "card" ? "Safety cars, retirements and conditions" : "Safety cars, incidents and conditions"}
      scope={scopeLine([
        variant === "card" ? null : context.raceLabel ?? `${context.season}`,
        raceLaps ? `${raceLaps} laps` : null,
        rowStates.neutralised ? "neutralisations unavailable" : `${bands.length} neutralisations`,
        rowStates.incidents ? "incidents unavailable" : `${events.length} incidents`,
      ])}
      endpoints={base ? [`${base}/safety-cars`, `${base}/incidents`, `${base}/pitstops`, `${base}/weather`] : []}
      source={safetyCars.payload?.meta ?? weather.payload?.meta}
      exportRows={exportRows}
      exportName={exportBasename("race-timeline", context.season, context.roundSlug)}
      footnote={variant === "card" ? undefined : "Safety-car, incident and weather rows are non-official OpenF1 enrichment (CC BY-NC-SA 4.0). A missing end lap is shown as such, never extended."}
    >
      {base == null ? (
        <NotPublished title="No race selected" detail="Choose a race to see its timeline." />
      ) : loading ? (
        <ViewSkeleton label="Loading race timeline" rows={4} />
      ) : allFailed ? (
        <NotPublished title="Race timeline unavailable" detail="None of the safety-car, incident, pit-stop and weather endpoints answered for this race. Nothing is inferred." source="/safety-cars · /incidents · /pitstops · /weather" tone="amber" />
      ) : (
        <div className="space-y-5">
          {variant === "card" && (
            <p className="text-[13px] text-white/[0.70]" data-retirements>
              Retirements ·{" "}
              {rowStates.incidents ? <span className="text-ambre">not available</span> : retirements.length ? <span className="text-white/[0.86]">{retirements.join(" · ")}</span> : "none published"}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Weather at the race">
            {weatherState ? (
              <span className={`text-[13px] ${weather.status === "error" ? "text-ambre" : "text-white/[0.70]"}`}>{weatherState}</span>
            ) : weatherItems.length === 0 ? (
              <span className="text-[13px] text-white/[0.70]">Weather · not published for this session</span>
            ) : (
              weatherItems.map(([label, value]) => (
                <span key={label} className="text-[13px] text-white/[0.70]">
                  {label} <span className="ml-1 font-mono text-[13px] text-light">{value ?? "not published"}</span>
                </span>
              ))
            )}
          </div>
          {raceLaps > 0 ? (
            <RaceTimeline raceLaps={raceLaps} bands={bands} incidents={events} pitDensity={density} unavailable={rowStates} syncGroup="lap" compact={variant === "card"} />
          ) : (
            <NotPublished detail="The race distance is unknown until results are published, so no lap axis is drawn." source="race results" />
          )}
        </div>
      )}
    </ViewCard>
  );
}
