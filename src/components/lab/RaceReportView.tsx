"use client";

import dynamic from "next/dynamic";
import { useContext, useId, type ReactNode } from "react";
import { buildNeutralisationBands } from "@/lib/lab-analytics";
import {
  asArray,
  exportBasename,
  readAvailabilityInfo,
  type LabFastestLaps,
  type LabSafetyCar,
} from "@/lib/lab-client";
import {
  biggestGainFigure,
  fastestLapFigure,
  neutralisationFigure,
  raceLaps,
  winnerFigure,
  type KeyFigure,
} from "@/lib/lab-insights.mjs";
import { biggestClimbFigure, type ClimbFigure, type LabPositionsPayload } from "@/lib/lab-strategy.mjs";
import { readableTeamColor, teamColor } from "@/lib/team-colors";
import type { LabViewId } from "@/lib/lab-workspace.mjs";
import { TeamBars } from "./charts/TeamBars";
import { FastestLapsView, RaceTimelineView, StrategyGlanceCard } from "./LabViews";
import { LazyView, ViewPlaceholder } from "./LazyView";
import { useLabResource, type LabResource } from "./useLabResource";
import { ApiPanel, ApiPanelContext, NotPublished, SourceLine, ViewCard, ViewMenu } from "./ViewCard";
import { scopeLine, type LabViewContext } from "./view-shared";

const ChampionshipView = dynamic(() => import("./SeasonViews").then((module) => module.ChampionshipView), {
  ssr: false,
  loading: () => <ViewPlaceholder id="lab-report-progression" title="Championship progression" variant="card" />,
});

export interface ReportRace {
  round: number;
  /** Full official name as published by the calendar (NOMENCLATURE.md). */
  name: string;
  date: string;
  /** "R11" when formula1.com certifies the round, otherwise null. */
  officialRound: string | null;
  circuit: { name: string; city: string; country: string } | null;
  completed: boolean;
}

interface RaceReportViewProps {
  context: LabViewContext;
  race: ReportRace | null;
  /** True when this race is the season's latest completed round. */
  isLatestCompleted: boolean;
  onSelectView: (view: LabViewId) => void;
  /** Data coverage and provenance of the race payload, rendered under the cards. */
  coverage?: ReactNode;
}

function longDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Neutralisation figure from the safety-car resource: an outage or an API reason is never shown as "none". */
function neutralisedFrom(resource: LabResource<LabSafetyCar[]>, laps: number | null): KeyFigure | "loading" {
  if (resource.status === "loading") return "loading";
  if (resource.status === "error") {
    return { state: "unavailable", reason: `The safety-car endpoint did not answer${resource.errorStatus ? ` (HTTP ${resource.errorStatus})` : ""}.` };
  }
  const { availability, reason } = readAvailabilityInfo(resource.data);
  if (availability === "unavailable") return { state: "unavailable", reason: reason ?? "Safety-car periods are not published for this race." };
  return neutralisationFigure(buildNeutralisationBands(asArray<LabSafetyCar>(resource.data), laps));
}

function fastestFrom(resource: LabResource<LabFastestLaps>): KeyFigure | "loading" {
  if (resource.status === "loading") return "loading";
  if (resource.status === "error") {
    return { state: "unavailable", reason: `The fastest-lap endpoint did not answer${resource.errorStatus ? ` (HTTP ${resource.errorStatus})` : ""}.` };
  }
  const figure = fastestLapFigure(asArray(resource.data?.fastest_laps));
  if (figure.state === "unavailable") {
    const { reason } = readAvailabilityInfo(resource.data);
    return reason ? { state: "unavailable", reason } : figure;
  }
  return figure;
}

/**
 * Biggest climb of the race: from lap-by-lap positions when every classified
 * driver is covered, restricted (and labelled) to the covered drivers when
 * they are partial, otherwise grid → finish from the official classification
 * (labelled as such). Loading results or positions never shows a number.
 */
function climbFrom(resource: LabResource<LabPositionsPayload>, results: LabViewContext["results"], resultsLoading: boolean): ClimbFigure | "loading" {
  if (resultsLoading || resource.status === "loading") return "loading";
  const published = resource.status === "ready" && readAvailabilityInfo(resource.data).availability !== "unavailable";
  return biggestClimbFigure(published ? resource.data : null, results);
}

function PositionsLine({ figure, onOpen }: { figure: ClimbFigure | "loading"; onOpen: () => void }) {
  const recovery = figure !== "loading" && figure.state === "ok" && figure.basis !== "grid";
  const label = recovery ? "Biggest recovery in the race (from lowest running position)" : "Biggest gain from the grid";
  const definition = recovery ? "Lowest position held while running, including the grid, minus finishing position. Only drivers with complete lap positions are compared." : "Starting grid position minus finishing position in the official classification.";
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-white/[0.08] bg-white/[0.018] px-3 py-1.5 text-[13px] text-white/[0.70] md:order-first md:px-4 xl:col-span-2" data-positions-line>
      <span className="text-white/[0.86]">Positions</span>
      <span aria-hidden="true">·</span>
      {figure === "loading" ? (
        <span className="inline-block h-4 w-40 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" role="status"><span className="sr-only">Loading positions</span></span>
      ) : figure.state === "ok" ? (
        <span className="min-w-0">
          <span title={definition} tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2" data-climb-label>{label}</span> <span className="font-mono text-light" data-climb-value>{figure.value}</span> · <span data-climb-detail>{figure.detail}</span>
          <span className="text-white/[0.62]" data-climb-basis={figure.basis}> · {figure.scope}</span>
        </span>
      ) : (
        <span className="min-w-0"><span className="text-ambre">Not available</span> · {figure.reason}</span>
      )}
      <button type="button" onClick={onOpen} className="ml-auto inline-flex min-h-11 items-center text-[13px] text-white/[0.78] underline-offset-4 hover:text-light hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-teal/70 lg:min-h-8">
        Positions lap by lap →
      </button>
    </div>
  );
}

function Figure({ id, label, figure }: { id: string; label: string; figure: KeyFigure | "loading" }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.018] px-3 py-1.5 md:px-4 md:py-3.5" data-key-figure={id}>
      <dt className="text-[13px] text-white/[0.70]" title={id === "biggest-gain" ? "Starting grid position minus finishing position in the official classification." : undefined} tabIndex={id === "biggest-gain" ? 0 : undefined}>{label}</dt>
      {figure === "loading" ? (
        <dd className="mt-1 h-8 w-24 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" role="status"><span className="sr-only">Loading {label.toLowerCase()}</span></dd>
      ) : figure.state === "ok" ? (
        <>
          <dd className="mt-1 break-words font-serif text-[20px] leading-7 text-light md:text-[24px] md:leading-8" title={figure.value} data-figure-value>{figure.value}</dd>
          <dd className="mt-0.5 break-words text-[13px] leading-[18px] text-white/[0.70]" title={figure.detail} data-figure-detail>{figure.detail}</dd>
        </>
      ) : (
        <>
          <dd className="mt-1 font-serif text-[20px] leading-8 text-ambre" data-figure-value>Not available</dd>
          <dd className="mt-0.5 text-[13px] text-white/[0.70]" data-figure-detail>{figure.reason}</dd>
        </>
      )}
    </div>
  );
}

/**
 * Race report: the default view once a race is chosen. Header, four key
 * figures computed from the API, then cards of the same height and rhythm.
 * A figure the API cannot support says so; nothing is estimated.
 */
export function RaceReportView({ context, race, isLatestCompleted, onSelectView, coverage }: RaceReportViewProps) {
  const headingId = useId();
  const { open: apiOpen } = useContext(ApiPanelContext);
  const base = context.round == null ? null : `/v1/f1/races/${context.season}/${context.round}`;
  const fastest = useLabResource<LabFastestLaps>(base && `${base}/fastest-laps`);
  const safetyCars = useLabResource<LabSafetyCar[]>(base && `${base}/safety-cars`);
  const positions = useLabResource<LabPositionsPayload>(base && `${base}/positions`);
  const laps = raceLaps(context.results);
  const loadingResults = context.raceIsLoading;
  const figures: { id: string; label: string; figure: KeyFigure | "loading" }[] = [
    { id: "winner", label: "Winner", figure: loadingResults ? "loading" : winnerFigure(context.results) },
    { id: "fastest-lap", label: "Fastest lap", figure: fastestFrom(fastest) },
    { id: "biggest-gain", label: "Biggest gain from the grid", figure: loadingResults ? "loading" : biggestGainFigure(context.results) },
    { id: "neutralised", label: "Neutralised", figure: neutralisedFrom(safetyCars, laps) },
  ];
  const climb = climbFrom(positions, context.results, loadingResults);
  const exportRows = [...figures, { id: "biggest-climb", label: climb !== "loading" && climb.state === "ok" && climb.basis !== "grid" ? "Biggest recovery in the race (from lowest running position)" : "Biggest gain from the grid (positions fallback)", figure: climb }].map(({ label, figure }) => ({
    season: context.season,
    race: race?.name ?? context.raceLabel,
    figure: label,
    value: figure === "loading" ? null : figure.state === "ok" ? figure.value : null,
    detail: figure === "loading" ? "loading" : figure.state === "ok" ? figure.detail : figure.reason,
  }));
  const endpoints = base ? [`${base}/results`, `${base}/fastest-laps`, `${base}/safety-cars`, `${base}/positions`] : [];

  if (race == null || context.round == null) {
    return (
      <section id="lab-report" aria-labelledby={headingId} className="min-w-0">
        <h1 id={headingId} className="font-serif text-[26px] leading-8 text-light md:text-[30px] md:leading-9">Race report</h1>
        <div className="mt-4"><NotPublished title="No race selected" detail="Choose a race in the bar above to read its report." /></div>
      </section>
    );
  }

  const subline = [
    race.officialRound ? `Round ${race.officialRound.replace(/^R/, "")}` : null,
    race.circuit ? `${race.circuit.name}, ${race.circuit.city}` : null,
    longDate(race.date),
    laps ? `${laps} laps` : null,
  ].filter(Boolean).join(" · ");
  const sourceNote = race.completed ? "official results from formula1.com" : "race not run yet";

  const standings = [...context.standings]
    .filter((row) => row.points != null)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
    .slice(0, 6);
  const standingsEndpoint = `/v1/f1/standings/drivers/${context.season}`;

  return (
    <section id="lab-report" aria-labelledby={headingId} className="min-w-0 scroll-mt-32">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h1 id={headingId} className="font-serif text-[26px] leading-8 tracking-[-0.02em] text-light md:text-[30px] md:leading-9">{race.name}</h1>
          <p className="mt-1 text-[14px] leading-5 text-white/[0.70]" data-view-scope>{subline}<span className="hidden sm:inline"> · {sourceNote}</span></p>
        </div>
        <ViewMenu title="Race report" endpoints={endpoints} exportRows={exportRows} exportName={exportBasename("race-report", context.season, context.roundSlug)} />
      </header>

      {apiOpen && <ApiPanel title="Race report" endpoints={endpoints} exportRows={exportRows} exportName={exportBasename("race-report", context.season, context.roundSlug)} />}
      <dl className="mt-3 grid grid-cols-2 gap-2 md:mt-5 md:gap-2.5 lg:grid-cols-4" aria-label="Key figures" data-key-figures>
        {figures.map((item) => <Figure key={item.id} {...item} />)}
      </dl>

      {/* Tighter spacing on a phone so the first chart clears the fixed action bar. */}
      <div className="mt-3 grid grid-cols-1 gap-3 md:mt-5 xl:grid-cols-2">
        <FastestLapsView context={context} variant="card" limit={6} onShowAll={() => onSelectView("fastest")} />
        {positions.data?.availability === "complete" && (positions.data.post_race_adjustments?.length ?? 0) > 0 && positions.data.reason && (
          <p className="text-[13px] text-white/[0.70] xl:col-span-2" data-official-adjustments>{positions.data.reason}</p>
        )}
        {/* After the first chart on a phone (it must stay in the first screen), right under the key figures from md up. */}
        <PositionsLine figure={climb} onOpen={() => onSelectView("positions")} />
        <RaceTimelineView context={context} variant="card" />
        <StrategyGlanceCard context={context} onShowAll={() => onSelectView("strategy")} />
        <ViewCard
          id="lab-report-standings"
          variant="card"
          title={isLatestCompleted ? `Championship after ${race.officialRound ?? "this race"}` : "Championship standings today"}
          scope={scopeLine([
            "Official total, sprints included",
            isLatestCompleted ? null : "as published now, not as they stood after this race",
            standings.length ? `top ${standings.length}` : null,
          ])}
          endpoints={[standingsEndpoint]}
          source={{ source: "tdd" }}
          exportRows={standings.map((row) => ({ season: context.season, position: row.position, driver_code: row.driver_code, driver: `${row.first_name} ${row.last_name}`, team: row.team_name, points: row.points }))}
          exportName={exportBasename("standings", context.season, null)}
        >
          {standings.length === 0 ? (
            <NotPublished title="Standings not published" detail="The API returned no driver standings for this season." source={standingsEndpoint} />
          ) : (
            <>
              <TeamBars
                rows={standings.map((row, index) => ({
                  id: row.driver_id,
                  rank: row.position ?? index + 1,
                  label: row.last_name,
                  sub: row.team_name,
                  color: teamColor(row.team_name),
                  textColor: readableTeamColor(row.team_name),
                  value: row.points ?? 0,
                  display: String(row.points ?? ""),
                }))}
              />
              <button type="button" onClick={() => onSelectView("championship")} className="mt-3 inline-flex min-h-11 items-center text-[13px] lg:min-h-9 text-white/[0.78] underline-offset-4 hover:text-light hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-teal/70">
                Full championship →
              </button>
            </>
          )}
        </ViewCard>
        <LazyView id="lab-report-progression" placeholder={<ViewPlaceholder id="lab-report-progression" title="Championship progression" variant="card" />}>
          <ChampionshipView context={context} variant="card" uptoRound={context.round} />
        </LazyView>
      </div>
      {coverage}
      <SourceLine source={{ source: "formula1.com results via The Data Driver API" }} footnote="Key figures: winner and biggest gain from the grid use the official classification (grid to finish, classified drivers with a grid slot); fastest lap comes from /fastest-laps. Neutralisations, tyre strategy and biggest recovery in the race (lowest position held from the grid onwards to the finish) use OpenF1 enrichment (CC BY-NC-SA 4.0, non-official). When lap-by-lap positions are not published, the positions line uses the official grid-to-finish gain and labels that fallback. Each card's ⋯ menu exports its rows and copies its API request." />
    </section>
  );
}
