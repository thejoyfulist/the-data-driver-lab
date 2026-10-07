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
import {
  biggestClimbFigure,
  buildPositionSeries,
  buildTyreStrategy,
  TYRE_COMPOUNDS,
  type LabPositionsPayload,
  type LabStintsPayload,
  type TyreStrategyRow,
} from "@/lib/lab-strategy.mjs";
import { readableTeamColor, teamColor } from "@/lib/team-colors";
import { LineChart, type LineSeries } from "./charts/LineChart";
import { PositionChart, PositionsTable } from "./charts/PositionChart";
import { RaceTimeline } from "./charts/RaceTimeline";
import { StintTimeline } from "./charts/StintTimeline";
import { TeamBars } from "./charts/TeamBars";
import { TyreStrategyChart } from "./charts/TyreStrategy";
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
 * Views of the selected race (pace, strategy, positions, fastest laps, timeline). They
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

// ── Lap-by-lap enrichment states (/stints, /positions) ──────────────────

type EnrichmentState =
  | { kind: "loading" }
  | { kind: "ready"; partial: string | null }
  | { kind: "missing"; title: string; detail: string; tone: "neutral" | "amber" };

/**
 * State of an OpenF1-backed race dataset. A 404 or an API "unavailable" is
 * "not published yet" (the endpoint or the session is not there yet); any
 * other failure is an outage. Never shown as "nothing happened".
 */
function enrichmentState(resource: LabResource<unknown>, label: string, path: string, hasRows: boolean): EnrichmentState {
  if (resource.status === "loading") return { kind: "loading" };
  if (resource.status === "error") {
    return resource.errorStatus === 404
      ? { kind: "missing", title: `${label} not published yet`, detail: `The API does not publish ${path} for this race yet (HTTP 404). Nothing is inferred.`, tone: "neutral" }
      : { kind: "missing", title: `${label} unavailable`, detail: `${path} did not answer${resource.errorStatus ? ` (HTTP ${resource.errorStatus})` : ""}. Nothing is inferred.`, tone: "amber" };
  }
  const { availability, reason } = readAvailabilityInfo(resource.data);
  if (availability === "unavailable" || !hasRows) {
    return { kind: "missing", title: `${label} not published yet`, detail: reason ?? `The API has no ${label.toLowerCase()} for this race yet.`, tone: "neutral" };
  }
  return { kind: "ready", partial: availability === "partial" ? reason ?? "Some laps or drivers are missing from the source." : null };
}

function PartialNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mt-3 text-[13px] text-ambre" data-partial>Partial data · {text}</p>;
}

// ── Strategy ────────────────────────────────────────────────────────────

const STRATEGY_SOURCE_NOTE = "Compounds, stint laps and tyre ages are non-official OpenF1 enrichment (CC BY-NC-SA 4.0); pit stops come from the formula1.com pit-stop summary.";

function useTyreStrategy(context: LabViewContext) {
  const base = context.round == null ? null : `/v1/f1/races/${context.season}/${context.round}`;
  const stintsEndpoint = base && `${base}/stints`;
  const pitEndpoint = base && `${base}/pitstops`;
  const stints = useLabResource<LabStintsPayload>(stintsEndpoint);
  const pits = useLabResource<LabPitStop[]>(pitEndpoint);
  const stops = asArray<LabPitStop>(pits.data);
  const strategy = useMemo(() => buildTyreStrategy(stints.data, context.results, stops), [stints.data, context.results, stops]);
  const tyres = enrichmentState(stints, "Tyre compounds", "/stints", strategy.rows.length > 0);
  return { base, stintsEndpoint, pitEndpoint, stints, pits, stops, strategy, tyres };
}

function stintExportRows(context: LabViewContext, rows: readonly TyreStrategyRow[]) {
  return rows.flatMap((row) => row.stints.map((stint) => ({
    season: context.season,
    race: context.raceLabel,
    finish: row.finish,
    driver_code: row.code,
    driver: row.name,
    team: row.team,
    stint: stint.number,
    compound: stint.compound,
    start_lap: stint.start,
    end_lap: stint.end,
    laps: stint.laps,
    tyre_age_at_start: stint.ageAtStart,
    pit_stop_laps: row.stops.filter((stop) => !stop.derived).map((stop) => stop.lap).join(" ") || null,
  })));
}

export function StrategyView({ context }: { context: LabViewContext }) {
  const { stintsEndpoint, pitEndpoint, stints, pits, stops, strategy, tyres } = useTyreStrategy(context);
  const plans = useMemo(() => buildStintPlans(stops, context.results), [stops, context.results]);
  const pitRows = plans
    .filter((plan) => plan.stints.length > 0)
    .map((plan) => ({ ...plan, color: teamColor(plan.team), textColor: readableTeamColor(plan.team) }));
  const pitMaxLap = Math.max(...pitRows.map((row) => row.totalLaps ?? row.stints.at(-1)?.end ?? 0), 1);
  const fastest = [...stops].filter((stop) => isFiniteNumber(stop.duration_ms)).sort((a, b) => (a.duration_ms as number) - (b.duration_ms as number))[0];
  const tyresReady = tyres.kind === "ready";
  const pitExport = stops.map((stop) => ({
    season: context.season,
    race: context.raceLabel,
    driver_code: stop.driver_code,
    driver: `${stop.first_name ?? ""} ${stop.last_name ?? ""}`.trim(),
    stop: stop.stop,
    lap: stop.lap,
    pit_lane_ms: stop.duration_ms,
  }));

  const pitBody = pitEndpoint == null ? null : pits.status === "loading" ? (
    <ViewSkeleton label="Loading pit stops" rows={8} />
  ) : pits.status === "error" ? (
    <NotPublished title="Pit stops unavailable" detail="The pit-stop endpoint did not answer for this race. Nothing is inferred." source="/pitstops" tone="amber" />
  ) : stops.length === 0 ? (
    <NotPublished detail="The API has no pit-stop summary for this race yet." source="formula1.com pit-stop summary via /pitstops" />
  ) : (
    <StintTimeline rows={pitRows} maxLap={pitMaxLap} />
  );

  return (
    <ViewCard
      id="lab-strategy"
      title="Tyre strategy"
      scope={scopeLine([
        context.raceLabel ?? `${context.season}`,
        tyresReady ? `${strategy.rows.length} drivers` : `${pitRows.length} drivers`,
        `${stops.length} pit stops`,
        tyresReady ? null : "compounds not published yet",
        "ordered by finishing position",
      ])}
      endpoints={[stintsEndpoint, pitEndpoint].filter((endpoint): endpoint is string => endpoint != null)}
      source={tyresReady ? stints.payload?.meta : pits.payload?.meta}
      exportRows={tyresReady ? stintExportRows(context, strategy.rows) : pitExport}
      exportName={exportBasename(tyresReady ? "tyre-strategy" : "pit-stops", context.season, context.roundSlug)}
      footnote={`${STRATEGY_SOURCE_NOTE}${fastest ? ` Shortest pit-lane time: ${fastest.driver_code ?? ""} ${formatLapMs(fastest.duration_ms)} (lap ${fastest.lap}).` : ""}`}
      table={tyresReady ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead><tr className={tableHead}><th scope="col" className="px-3 py-2">Driver</th><th scope="col" className="px-3 py-2">Finish</th><th scope="col" className="px-3 py-2">Stint</th><th scope="col" className="px-3 py-2">Compound</th><th scope="col" className="px-3 py-2">Laps</th><th scope="col" className="px-3 py-2">Tyre age at start</th></tr></thead>
            <tbody>
              {strategy.rows.flatMap((row) => row.stints.map((stint) => (
                <tr key={`${row.code}-${stint.number}-${stint.start}`} className="border-b border-white/[0.04]">
                  <th scope="row" className="px-3 py-2 text-left text-[13px] font-normal text-white/[0.84]"><span className="font-mono text-[12px]">{row.code}</span> <span className="text-white/[0.70]">{row.name}</span></th>
                  <td className={tableCell}>{row.finish != null ? `P${row.finish}` : "Not classified"}</td>
                  <td className={tableCell}>{stint.number}</td>
                  <td className={tableCell}>{TYRE_COMPOUNDS[stint.compound].label}</td>
                  <td className={tableCell}>{stint.start}–{stint.end} ({stint.laps})</td>
                  <td className={tableCell}>{stint.ageAtStart == null ? "Not published" : stint.ageAtStart === 0 ? "New" : `${stint.ageAtStart} laps`}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      ) : (
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
      )}
    >
      {stintsEndpoint == null ? (
        <NotPublished title="No race selected" detail="Choose a race to read its tyre strategy." />
      ) : context.raceIsLoading || tyres.kind === "loading" ? (
        <ViewSkeleton label="Loading tyre strategy" rows={8} />
      ) : tyres.kind === "ready" ? (
        <>
          <TyreStrategyChart rows={strategy.rows} maxLap={strategy.maxLap} />
          <PartialNote text={tyres.partial} />
        </>
      ) : (
        <div className="space-y-4">
          <div data-tyres-state>
            <NotPublished title={tyres.title} detail={tyres.detail} source="/stints" tone={tyres.tone} />
          </div>
          {pitBody && (
            <div className="border-t border-white/[0.06] pt-4">
              <p className="mb-3 text-[13px] text-white/[0.70]">Meanwhile, the official pit stops: stints are numbered, not coloured by compound.</p>
              {pitBody}
            </div>
          )}
        </div>
      )}
    </ViewCard>
  );
}

/** Race report card: the tyre strategy of the first ten finishers. */
export function StrategyGlanceCard({ context, onShowAll }: { context: LabViewContext; onShowAll?: () => void }) {
  const { stintsEndpoint, stints, strategy, tyres } = useTyreStrategy(context);
  const top = strategy.rows.filter((row) => row.finish != null).slice(0, 10);
  return (
    <ViewCard
      id="lab-report-strategy"
      variant="card"
      title="Strategy at a glance"
      scope={scopeLine([tyres.kind === "ready" ? `top ${top.length} finishers` : null, "compound per stint", "pit stops marked"])}
      endpoints={stintsEndpoint ? [stintsEndpoint] : []}
      source={stints.payload?.meta}
      exportRows={stintExportRows(context, top)}
      exportName={exportBasename("strategy-top10", context.season, context.roundSlug)}
    >
      {stintsEndpoint == null ? (
        <NotPublished title="No race selected" detail="Choose a race to read its tyre strategy." />
      ) : context.raceIsLoading || tyres.kind === "loading" ? (
        <ViewSkeleton label="Loading tyre strategy" rows={6} />
      ) : tyres.kind === "missing" ? (
        <div data-tyres-state><NotPublished title={tyres.title} detail={tyres.detail} source="/stints" tone={tyres.tone} /></div>
      ) : top.length === 0 ? (
        <NotPublished title="No classified finisher" detail="The official classification is not published, so no finishing order is drawn." source="race results" />
      ) : (
        <>
          <TyreStrategyChart rows={top} maxLap={strategy.maxLap} compact />
          <PartialNote text={tyres.partial} />
          {onShowAll && (
            <button type="button" onClick={onShowAll} className="mt-3 inline-flex min-h-11 items-center text-[13px] lg:min-h-9 text-white/[0.78] underline-offset-4 hover:text-light hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70">
              Full strategy and legend →
            </button>
          )}
        </>
      )}
    </ViewCard>
  );
}

// ── Positions ───────────────────────────────────────────────────────────

export function PositionsView({ context }: { context: LabViewContext }) {
  const base = context.round == null ? null : `/v1/f1/races/${context.season}/${context.round}`;
  const positions = useLabResource<LabPositionsPayload>(base && `${base}/positions`);
  const safetyCars = useLabResource<LabSafetyCar[]>(base && `${base}/safety-cars`);
  const incidents = useLabResource<LabIncident[]>(base && `${base}/incidents`);
  const pitStops = useLabResource<LabPitStop[]>(base && `${base}/pitstops`);
  const [, setLapCursor] = useChartCursor("lap");
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const series = useMemo(() => buildPositionSeries(positions.data, context.results), [positions.data, context.results]);
  const state = enrichmentState(positions, "Lap-by-lap positions", "/positions", series.drivers.length > 0);
  const drivers = dashTeammates(series.drivers);
  const codes = new Set(series.drivers.map((driver) => driver.code));
  const highlighted = picked ?? new Set(context.selectedDrivers.map((driver) => driver.code).filter((code) => codes.has(code)));
  const raceLaps = series.raceLaps ?? Math.max(0, ...context.results.map((result) => (isFiniteNumber(result.laps) ? result.laps : 0)));
  const bands = buildNeutralisationBands(asArray<LabSafetyCar>(safetyCars.data), raceLaps || null);
  const climb = biggestClimbFigure(state.kind === "ready" ? positions.data : null, context.results);
  const exportRows = series.drivers.flatMap((driver) => driver.points.map((point) => ({
    season: context.season,
    race: context.raceLabel,
    driver_code: driver.code,
    driver: driver.name,
    team: driver.team,
    grid: driver.grid,
    finish: driver.finish,
    lap: point.lap,
    position: point.position,
  })));

  function toggle(code: string) {
    const next = new Set(highlighted);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPicked(next);
  }

  return (
    <ViewCard
      id="lab-positions"
      title="Positions lap by lap"
      scope={scopeLine([
        context.raceLabel ?? `${context.season}`,
        state.kind === "ready" ? `${series.drivers.length} drivers` : null,
        state.kind === "ready" ? `grid to lap ${series.maxLap}` : null,
        highlighted.size ? `${highlighted.size} highlighted` : null,
      ])}
      endpoints={base ? [`${base}/positions`, `${base}/safety-cars`] : []}
      source={positions.payload?.meta}
      exportRows={exportRows}
      exportName={exportBasename("positions", context.season, context.roundSlug)}
      footnote={`Lap-by-lap positions are non-official OpenF1 enrichment (CC BY-NC-SA 4.0); finishing positions come from the official classification. A lap without a published position is left as a gap, never interpolated.${series.method ? ` Method: ${series.method}` : ""}`}
      table={state.kind === "ready" ? <PositionsTable drivers={series.drivers} maxLap={series.maxLap} /> : undefined}
    >
      {base == null ? (
        <NotPublished title="No race selected" detail="Choose a race to read its running order." />
      ) : context.raceIsLoading || state.kind === "loading" ? (
        <ViewSkeleton label="Loading positions" rows={8} />
      ) : state.kind === "missing" ? (
        <div className="space-y-3" data-positions-state>
          <NotPublished title={state.title} detail={state.detail} source="/positions" tone={state.tone} />
          {climb.state === "ok" && (
            <p className="text-[13px] text-white/[0.70]">From the official classification instead: biggest gain grid to finish <span className="font-mono text-light">{climb.value}</span> · {climb.detail}.</p>
          )}
        </div>
      ) : (
        <>
          <PositionChart drivers={drivers} maxLap={series.maxLap} maxPosition={series.maxPosition} highlighted={highlighted} bands={bands} syncGroup="lap" />
          <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="Highlight drivers" data-position-legend>
            {drivers.map((driver) => {
              const on = highlighted.has(driver.code);
              return (
                <button
                  key={driver.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(driver.code)}
                  title={on ? `Stop highlighting ${driver.name}` : `Highlight ${driver.name}`}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-mono text-[12px] transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 lg:min-h-8 ${on ? "bg-white/[0.06]" : ""}`}
                  style={{ color: readableTeamColor(driver.team) }}
                >
                  <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true" className="shrink-0">
                    <line x1="1" x2="17" y1="4" y2="4" stroke={teamColor(driver.team)} strokeWidth="2" strokeDasharray={driver.dashed ? "4 3" : undefined} strokeLinecap="round" />
                  </svg>
                  {driver.code}
                  <span className="sr-only">{driver.name}</span>
                </button>
              );
            })}
            {highlighted.size > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="inline-flex min-h-11 items-center rounded-md px-2 text-[13px] text-white/[0.70] underline-offset-4 hover:text-light hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 lg:min-h-8">
                Show all equally
              </button>
            )}
          </div>
          <PartialNote text={state.partial} />
          <p className="mt-3 text-[13px] text-white/[0.70]" data-biggest-climb>
            Biggest climb ·{" "}
            {climb.state === "ok" ? <><span className="font-mono text-light">{climb.value}</span> · {climb.detail}</> : <span className="text-ambre">{climb.reason}</span>}
          </p>
          {raceLaps > 0 && (
            <div className="mt-4 border-t border-white/[0.06] pt-4" onPointerLeave={() => setLapCursor(null)} data-positions-strip>
              <p className="mb-2 text-[13px] text-white/[0.70]">Same lap axis: neutralisations, pit stops and incidents. The cursor follows the chart.</p>
              <RaceTimeline
                raceLaps={raceLaps}
                bands={bands}
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
        </>
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
