"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandItem } from "@/components/lab/CommandPalette";
import {
  FastestLapsView,
  PaceView,
  PositionsView,
  RaceTimelineView,
  StrategyView,
  type LabViewContext,
} from "@/components/lab/LabViews";
import { LabInspector, type InspectorShortcut } from "@/components/lab/LabInspector";
import { barButton, DriverChips, MobileActionBar, RacePicker, ViewNav } from "@/components/lab/LabWorkspace";
import { ViewPlaceholder } from "@/components/lab/LazyView";
import { RaceReportView } from "@/components/lab/RaceReportView";
import { ChartCursorProvider } from "@/components/lab/charts/chart-utils";
import { TeamBars } from "@/components/lab/charts/TeamBars";
import { LabResourceProvider, type LabSeed } from "@/components/lab/useLabResource";
import { ApiPanelContext, NotPublished, ViewCard, ViewSkeleton } from "@/components/lab/ViewCard";
import { tableCell, tableHead } from "@/components/lab/view-shared";
import { buildPracticeBest, type PracticeBestSummary } from "@/lib/lab-analytics";
import {
  copyText,
  exportBasename,
  fetchLab,
  formatLapMs,
  LAB_PROXY_BASE,
  LabAPIError,
  type LabPayload,
  type LabSourceMeta,
} from "@/lib/lab-client";
import { readableTeamColor, teamColor } from "@/lib/team-colors";
import { getCanonicalDriverCode } from "@/lib/driver-codes";
import { isRaceWeekend, nextLiveInterval, raceWeekendWindow, relativeUpdate } from "@/lib/lab-live-policy";
import {
  defaultLabView,
  formatCountdown,
  formatRaceDay,
  isLabViewId,
  LAB_VIEWS,
  labViewDef,
  nextRaceAfter,
  raceStartMs,
  type LabViewId,
} from "@/lib/lab-workspace.mjs";
import { LIVE_SEASON, SITE_URL, LAB_PATH, REPO_URL } from "@/lib/site";
import type { APICalendarRace, APIRacePredictions } from "@/lib/api-types";
import { officialRoundLabel, sortRacesChronologically } from "@/lib/site-display.mjs";
import {
  apiSourceHref,
  buildDriverHeadToHead,
  buildStarterAnswer,
  createLatestRequestGate,
  normalizeChatPayload,
  STARTER_QUESTIONS,
  transitionInitialSeasonRestore,
} from "@/lib/lab-grounded-queries.mjs";

// Season-wide views, the telemetry tab and the command palette load in the
// browser on demand: their code and their requests stay out of the server
// render and of the first JavaScript payload. The race report (the default
// view) is server-rendered.
const ChampionshipView = dynamic(() => import("@/components/lab/SeasonViews").then((module) => module.ChampionshipView), {
  ssr: false,
  loading: () => <ViewPlaceholder id="lab-championship" title="Championship progression" />,
});
const ConstructorsView = dynamic(() => import("@/components/lab/SeasonViews").then((module) => module.ConstructorsView), {
  ssr: false,
  loading: () => <ViewPlaceholder id="lab-constructors" title="Constructors' championship" />,
});
const HeadToHeadRecord = dynamic(() => import("@/components/lab/SeasonViews").then((module) => module.HeadToHeadRecord), {
  ssr: false,
  loading: () => <div className="mt-5"><ViewSkeleton label="Loading head-to-head record" rows={3} /></div>,
});
const TelemetryPanel = dynamic(() => import("@/components/lab/SeasonViews").then((module) => module.TelemetryPanel), {
  ssr: false,
  loading: () => <ViewSkeleton label="Loading telemetry" rows={4} />,
});
const CommandPalette = dynamic(() => import("@/components/lab/CommandPalette").then((module) => module.CommandPalette), { ssr: false });
// The AI mode (and the AI SDK it needs) loads only when a visitor opens it.
// Zod (used by the AI SDK) probes `new Function` unless it is jitless; the
// enforced CSP has no 'unsafe-eval'. Set the shared Zod config when this
// module loads, before any Zod copy runs (next/dynamic does not call a named
// loader early enough). Mutate rather than replace the shared object.
if (typeof globalThis !== "undefined") {
  const zodGlobal = globalThis as { __zod_globalConfig?: Record<string, unknown> };
  zodGlobal.__zod_globalConfig ??= {};
  zodGlobal.__zod_globalConfig.jitless = true;
}
const AskAiPanel = dynamic(() => import("@/components/lab/AskAiPanel"), {
  ssr: false,
  loading: () => <div className="mt-5"><ViewSkeleton label="Loading AI mode" rows={3} /></div>,
});
const AI_GUIDE_URL = `${REPO_URL}/blob/main/docs/AI.md`;

const PRACTICE_SESSIONS = ["FP1", "FP2", "FP3"] as const;

// Browser requests stay same-origin through the Next proxy (LAB_PROXY_BASE).
// This avoids making the Lab dependent on the API's allow-list matching the
// current Vercel domain.

interface LabStanding {
  position: number | null;
  driver_id: number;
  driver_code: string;
  first_name: string;
  last_name: string;
  team_name: string;
  points: number | null;
  wins: number | null;
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

interface LabCircuit {
  id: number;
  name: string;
  country: string;
  city: string;
  length_km: number | null;
  turns: number | null;
}

interface LabPageClientProps {
  calendar: APICalendarRace[];
  nextRace: APICalendarRace | null;
  circuits: LabCircuit[];
  initialSeason: number;
  initialRound: number | null;
  initialStandings: LabStanding[];
  initialResults: LabResult[];
  initialPredictions: APIRacePredictions | null;
  initialSourceTimestamp: string | null;
  initialIngestionReadiness: IngestionReadiness | null;
  initialSeasonError: boolean;
  initialRaceError: boolean;
  /** Server-fetched payloads for the initial race views, keyed by API path. */
  initialSeed?: LabSeed;
}

type Metric = "seasonPoints" | "raceFinish" | "grid" | "laps" | "winProbability";
type SortMode = "position" | "name" | "metric";
type SessionView = "race" | "practice" | "qualifying" | "qualifyingPrediction" | "telemetry";

const AVAILABLE_SEASONS = Array.from({ length: LIVE_SEASON - 1950 + 1 }, (_, i) => LIVE_SEASON - i);

interface LabQualifyingResult {
  position: number;
  first_name: string;
  last_name: string;
  team: string;
  q1: string | null;
  q2: string | null;
  q3: string | null;
}

interface LabQualifyingPrediction {
  position: number;
  driver_name: string;
  expected_position: number;
  p_pole: number;
  p_q3: number;
}

interface ComparisonDriver {
  id: number;
  name: string;
  tla: string;
}

interface LabRow {
  id: number;
  code: string;
  name: string;
  team: string;
  seasonPosition: number | null;
  seasonPoints: number | null;
  wins: number | null;
  racePosition: number | null;
  grid: number | null;
  laps: number | null;
  status: string | null;
  winProbability: number | null;
}

interface LabAnswer {
  answer: string;
  sources: { title: string; href?: string }[];
}

interface IngestionReadiness {
  ready: boolean;
  status: string;
  integrity_status?: string;
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

function SourceCitation({ source }: { source: LabAnswer["sources"][number] }) {
  const href = apiSourceHref(source.href, SITE_URL, LAB_PATH);
  const className = "rounded-full border border-white/[0.10] px-3 py-1.5 text-[12px] text-white/[0.70]";
  return href ? (
    <a href={href} className={`${className} hover:border-teal/30 hover:text-teal`}>
      {source.title}
    </a>
  ) : (
    <span className={className}>{source.title}</span>
  );
}
const metricDefinitions: { key: Metric; label: string; short: string; hint: string }[] = [
  { key: "seasonPoints", label: "Season points", short: "Points", hint: "Championship points" },
  { key: "raceFinish", label: "Race finish", short: "Finish", hint: "Lower is better" },
  { key: "grid", label: "Grid start", short: "Grid", hint: "Starting position" },
  { key: "laps", label: "Laps completed", short: "Laps", hint: "Race distance" },
  { key: "winProbability", label: "Win probability", short: "Win %", hint: "Only where forecast exists" },
];

const starterQuestions = Object.values(STARTER_QUESTIONS);

// Race names keep "Grand Prix" in full: NOMENCLATURE.md forbids the GP abbreviation.
function raceLabel(name: string) {
  return name
    .replace(/^Formula 1\s+/i, "")
    .replace(/^(?:Qatar Airways|Singapore Airlines|Etihad Airways|MSC Cruises|Louis Vuitton|Gulf Air|Crypto\.com|Moët & Chandon|TAG Heuer|Heineken|Pirelli|Aramco|Lenovo|AWS|stc)\s+/i, "")
    .replace(/\s+\d{4}$/, "");
}

function normalizeCircuitName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

function formatSourceTimestamp(value: string | null) {
  if (!value) return "Not supplied";
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

function formatValue(metric: Metric, value: number | null) {
  if (value == null) return "—";
  if (metric === "winProbability") return `${(value * 100).toFixed(1)}%`;
  if (metric === "seasonPoints") return value.toFixed(value % 1 === 0 ? 0 : 1);
  return value.toFixed(0);
}

function driverTla(firstName: string, lastName: string) {
  const normalized = lastName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase();
  return (normalized || firstName.slice(0, 3)).slice(0, 3);
}

function lastCompletedRound(calendar: APICalendarRace[]) {
  return [...calendar].reverse().find((race) =>
    race.status === "completed"
  )?.round
    ?? calendar[0]?.round
    ?? null;
}

function getMetricValue(row: LabRow, metric: Metric) {
  switch (metric) {
    case "seasonPoints":
      return row.seasonPoints;
    case "raceFinish":
      return row.racePosition;
    case "grid":
      return row.grid;
    case "laps":
      return row.laps;
    case "winProbability":
      return row.winProbability;
  }
}

function driverIdentity(code: string | null | undefined, name: string): string {
  const canonicalCode = code?.trim().toUpperCase();
  if (canonicalCode) return `code:${canonicalCode}`;
  return `name:${name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

function buildRows(
  standings: LabStanding[],
  results: LabResult[],
  predictions: APIRacePredictions | null,
): LabRow[] {
  // IDs are not stable across every upstream table. Join the same driver by
  // the published three-letter code (or normalized name), while preserving a
  // real source ID on the row for selection state.
  const byIdentity = new Map<string, LabRow>();
  const byId = new Map<number, LabRow>();

  for (const standing of standings) {
    const name = `${standing.first_name} ${standing.last_name}`;
    const code =
      getCanonicalDriverCode(standing.driver_id) ??
      standing.driver_code ??
      driverTla(standing.first_name, standing.last_name);
    const row: LabRow = {
      id: standing.driver_id,
      code,
      name,
      team: standing.team_name,
      seasonPosition: standing.position,
      seasonPoints: standing.points,
      wins: standing.wins,
      racePosition: null,
      grid: null,
      laps: null,
      status: null,
      winProbability: null,
    };
    byIdentity.set(driverIdentity(code, name), row);
    byId.set(standing.driver_id, row);
  }

  for (const result of results) {
    const name = `${result.first_name} ${result.last_name}`;
    const code =
      getCanonicalDriverCode(result.driver_id) ??
      result.driver_code ??
      driverTla(result.first_name, result.last_name);
    const identity = driverIdentity(code, name);
    const row = byIdentity.get(identity) ?? byId.get(result.driver_id) ?? {
      id: result.driver_id,
      code,
      name,
      team: result.team_name,
      seasonPosition: null,
      seasonPoints: null,
      wins: null,
      racePosition: null,
      grid: null,
      laps: null,
      status: null,
      winProbability: null,
    };
    Object.assign(row, {
      racePosition: result.position,
      grid: result.grid,
      laps: result.laps,
      status: result.status,
    });
    byIdentity.set(identity, row);
    byId.set(result.driver_id, row);
  }

  for (const prediction of predictions?.predictions ?? []) {
    const row = byIdentity.get(driverIdentity(prediction.driver_code, prediction.driver_name))
      ?? byId.get(prediction.driver_id);
    if (row) row.winProbability = prediction.p_win ?? prediction.probability;
  }

  return Array.from(new Set(byIdentity.values()));
}

export default function LabPageClient({
  calendar: initialCalendar,
  nextRace,
  circuits,
  initialSeason,
  initialRound,
  initialStandings,
  initialResults,
  initialPredictions,
  initialSourceTimestamp,
  initialIngestionReadiness,
  initialSeasonError,
  initialRaceError,
  initialSeed = {},
}: LabPageClientProps) {
  const reducedMotion = useReducedMotion();
  const defaultRound = initialRound ?? initialCalendar[0]?.round ?? null;
  const [season, setSeason] = useState(initialSeason);
  const [calendar, setCalendar] = useState(initialCalendar);
  const [calendarSeason, setCalendarSeason] = useState<number | null>(initialSeasonError ? null : initialSeason);
  const [round, setRound] = useState<number | null>(defaultRound);
  const [standings, setStandings] = useState(initialStandings);
  const [results, setResults] = useState(initialResults);
  const [predictions, setPredictions] = useState(initialPredictions);
  const [sourceTimestamp, setSourceTimestamp] = useState(initialSourceTimestamp);
  const [ingestionReadiness, setIngestionReadiness] = useState(initialIngestionReadiness);
  const [metric, setMetric] = useState<Metric>("seasonPoints");
  const [sortMode, setSortMode] = useState<SortMode>("position");
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [selectedDrivers, setSelectedDrivers] = useState<number[]>(
    initialStandings.slice(0, 3).map((driver) => driver.driver_id),
  );
  const [hasCustomDrivers, setHasCustomDrivers] = useState(false);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [seasonError, setSeasonError] = useState<string | null>(initialSeasonError ? "Season data is unavailable from the live API." : null);
  const [isLoadingRace, setIsLoadingRace] = useState(false);
  const [raceError, setRaceError] = useState<string | null>(initialRaceError ? "Race data is unavailable from the live API." : null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<LabAnswer | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [askMode, setAskMode] = useState<"grounded" | "ai">("grounded");
  const [sessionView, setSessionView] = useState<SessionView>("race");
  const [practiceBest, setPracticeBest] = useState<PracticeBestSummary | null>(null);
  const [qualifying, setQualifying] = useState<LabQualifyingResult[] | null>(null);
  const [qualifyingPrediction, setQualifyingPrediction] = useState<LabQualifyingPrediction[] | null>(null);
  // 409 = the API withheld the classification (integrity check). Shown as a
  // clean per-session state, never as a raw error banner.
  const [qualifyingWithheld, setQualifyingWithheld] = useState(false);
  const [sessionTimestamp, setSessionTimestamp] = useState<string | null>(null);
  const [sessionSourceMeta, setSessionSourceMeta] = useState<LabSourceMeta | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(defaultRound != null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [seasonStandings, setSeasonStandings] = useState<Record<number, LabStanding[]>>({
    [initialSeason]: initialStandings,
  });
  const [seasonTimestamps, setSeasonTimestamps] = useState<Record<number, string | null>>({
    [initialSeason]: null,
  });
  const [seasonLoadErrors, setSeasonLoadErrors] = useState<Record<number, boolean>>({});
  const [comparisonDriver, setComparisonDriver] = useState("");
  const [hasExplicitComparisonDriver, setHasExplicitComparisonDriver] = useState(false);
  const [isLoadingSeason, setIsLoadingSeason] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setView] = useState<LabViewId>(() => defaultLabView(defaultRound != null));
  const [apiOpen, setApiOpen] = useState(false);
  const [fieldMode, setFieldMode] = useState<"chart" | "table">("chart");
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  // A view, race or season chosen by the visitor adds a browser history
  // entry (Back returns to it); filters and restored state replace it.
  const historyModeRef = useRef<"push" | "replace">("replace");
  const focusViewRef = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [liveNow, setLiveNow] = useState<number | null>(null);
  const [livePaused, setLivePaused] = useState(false);
  const [liveOnline, setLiveOnline] = useState(true);
  const [liveVisible, setLiveVisible] = useState(true);
  const [liveTtl, setLiveTtl] = useState(60);
  const [liveFailures, setLiveFailures] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [liveHighlight, setLiveHighlight] = useState(false);
  const [liveResourceVersion, setLiveResourceVersion] = useState(0);
  const liveInFlight = useRef(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePublished = useRef(false);
  const livePracticePublished = useRef<Set<string>>(new Set());
  const liveWasInactive = useRef(false);
  const findInputRef = useRef<HTMLInputElement>(null);
  const answerKindRef = useRef<"starter" | "chat" | null>(null);
  const chatRequestGateRef = useRef(createLatestRequestGate());
  const seasonRef = useRef(season);
  const roundRef = useRef(round);
  const selectedDriversRef = useRef(selectedDrivers);
  const hasVisitedArchiveSeasonRef = useRef(false);
  // The server already fetched results, forecast and readiness for the
  // initial race: the browser only refetches once the race or season changes.
  const raceSelectionChangedRef = useRef(false);

  useEffect(() => {
    // Interactive from here on (end-to-end tests wait for this marker).
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!liveHighlight) return;
    const timer = setTimeout(() => setLiveHighlight(false), 200);
    return () => clearTimeout(timer);
  }, [liveHighlight]);

  const clearStarterAnswer = useCallback(() => {
    if (answerKindRef.current !== "starter") return;
    answerKindRef.current = null;
    setAnswer(null);
  }, []);

  const invalidateSemanticContext = useCallback(() => {
    chatRequestGateRef.current.invalidate();
    answerKindRef.current = null;
    setAnswer(null);
    setIsAsking(false);
  }, []);

  const changeSeason = useCallback((nextSeason: number) => {
    if (seasonRef.current === nextSeason) return;
    invalidateSemanticContext();
    setIsLoadingSeason(true);
    setIsLoadingRace(true);
    setIsLoadingSession(true);
    setSeasonError(null);
    setRaceError(null);
    setSessionError(null);
    setCalendarSeason(null);
    setCalendar([]);
    setStandings([]);
    setResults([]);
    setPredictions(null);
    setSourceTimestamp(null);
    setIngestionReadiness(null);
    setPracticeBest(null);
    setQualifying(null);
    setQualifyingPrediction(null);
    setSessionTimestamp(null);
    setSessionSourceMeta(null);
    raceSelectionChangedRef.current = true;
    roundRef.current = null;
    setRound(null);
    seasonRef.current = nextSeason;
    setSeason(nextSeason);
  }, [invalidateSemanticContext]);

  const changeRound = useCallback((nextRound: number | null) => {
    if (roundRef.current === nextRound) return;
    invalidateSemanticContext();
    setRaceError(null);
    setSessionError(null);
    setIsLoadingRace(nextRound != null);
    setIsLoadingSession(nextRound != null);
    setResults([]);
    setPredictions(null);
    setSourceTimestamp(null);
    setIngestionReadiness(null);
    setPracticeBest(null);
    setQualifying(null);
    setQualifyingPrediction(null);
    setSessionTimestamp(null);
    setSessionSourceMeta(null);
    raceSelectionChangedRef.current = true;
    roundRef.current = nextRound;
    setRound(nextRound);
  }, [invalidateSemanticContext]);

  const changeSelectedDrivers = useCallback((nextDrivers: number[]) => {
    if (selectedDriversRef.current.length === nextDrivers.length
      && selectedDriversRef.current.every((driverId, index) => driverId === nextDrivers[index])) return;
    selectedDriversRef.current = nextDrivers;
    invalidateSemanticContext();
    setSelectedDrivers(nextDrivers);
  }, [invalidateSemanticContext]);

  const selectedRace = calendar.find((race) => race.round === round) ?? null;
  const weekendRace = calendar.find((race) => liveNow != null && isRaceWeekend(race, liveNow)) ??
    (nextRace && liveNow != null && isRaceWeekend(nextRace, liveNow) ? nextRace : null);
  const liveActive = weekendRace != null && season === initialSeason && round === weekendRace.round;
  const liveStatus = !liveActive ? "Not a race weekend" : !liveOnline ? "Offline" : livePaused || !liveVisible ? "Paused" : "Live";
  const liveTimestamp = sessionSourceMeta?.data_fetched_at ?? sessionTimestamp ?? sourceTimestamp;

  useEffect(() => {
    const sync = () => {
      setLiveNow(Date.now());
      setLiveOnline(navigator.onLine);
      setLiveVisible(!document.hidden);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Outside a live weekend the "Next" countdown refreshes once a minute.
  // (During a live weekend the polling cycle owns the clock.)
  useEffect(() => {
    if (liveActive) return;
    const timer = window.setInterval(() => setLiveNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [liveActive]);

  const refreshLive = useCallback(async () => {
    if (liveInFlight.current || round == null) return;
    liveInFlight.current = true;
    const base = `/v1/f1/races/${season}/${round}`;
    const requests = await Promise.allSettled([
      fetchLab<LabStanding[]>(`/v1/f1/standings/drivers/${season}`),
      fetchLab<LabResult[]>(`${base}/results`),
      fetchLab<IngestionReadiness>(`${base}/ingestion-readiness`),
      fetchLab<LabQualifyingResult[] | null>(`${base}/qualifying`),
      fetchLab<APIRacePredictions>(`/v1/f1/predictions/race/${season}/${round}`),
      fetchLab<LabQualifyingPrediction[] | null>(`/v1/f1/predictions/qualifying/${season}/${round}`),
      ...PRACTICE_SESSIONS.map((session) => fetchLab<unknown>(`${base}/practice/${session}/best`)),
    ]);
    liveInFlight.current = false;
    const [nextStandings, nextResults, nextReadiness, nextQualifying, nextRacePrediction, nextQualifyingPrediction, ...nextPractice] = requests;
    const valid = requests.filter((entry): entry is PromiseFulfilledResult<LabPayload<unknown>> => entry.status === "fulfilled" && entry.value.data != null);
    if (valid.length === 0 || nextStandings.status === "rejected" || nextResults.status === "rejected") {
      setLiveFailures((count) => count + 1);
    } else {
      setLiveFailures(0);
    }
    if (valid.length === 0) return;
    const ttls = valid.map((entry) => entry.value.meta?.cache_ttl);
    setLiveTtl(nextLiveInterval(ttls, 0) / 1_000);
    if (nextStandings.status === "fulfilled" && Array.isArray(nextStandings.value.data) && nextStandings.value.data.length) {
      setStandings(nextStandings.value.data);
      setSeasonStandings((current) => ({ ...current, [season]: nextStandings.value.data }));
    }
    if (nextResults.status === "fulfilled" && Array.isArray(nextResults.value.data) && nextResults.value.data.length) {
      setResults(nextResults.value.data);
      setSourceTimestamp(nextResults.value.meta?.data_fetched_at ?? nextResults.value.timestamp);
    }
    if (nextReadiness.status === "fulfilled" && nextReadiness.value.data) setIngestionReadiness(nextReadiness.value.data);
    if (nextRacePrediction.status === "fulfilled" && nextRacePrediction.value.data?.predictions?.length) {
      setPredictions(nextRacePrediction.value.data);
    }
    if (nextQualifyingPrediction.status === "fulfilled" && Array.isArray(nextQualifyingPrediction.value.data) && nextQualifyingPrediction.value.data.length) {
      setQualifyingPrediction(nextQualifyingPrediction.value.data);
    }
    if (nextQualifying.status === "fulfilled" && Array.isArray(nextQualifying.value.data) && nextQualifying.value.data.length) {
      setQualifying(nextQualifying.value.data);
      setSessionTimestamp(nextQualifying.value.meta?.data_fetched_at ?? nextQualifying.value.timestamp);
      if (!livePublished.current) {
        livePublished.current = true;
        setLiveAnnouncement("Qualifying results published");
        setLiveHighlight(true);
      }
    }
    const practicePayloads = nextPractice.map((entry, index) => ({
      session: PRACTICE_SESSIONS[index],
      status: entry.status === "fulfilled" ? "ready" as const : "error" as const,
      data: entry.status === "fulfilled" ? entry.value.data : null,
      errorStatus: entry.status === "rejected" ? (entry.reason instanceof LabAPIError ? entry.reason.status : 0) : null,
    }));
    if (practicePayloads.some((entry) => entry.status === "ready" && entry.data != null)) {
      const publishedSessions = buildPracticeBest(practicePayloads).published;
      const newlyPublished = publishedSessions.filter((session) => !livePracticePublished.current.has(session));
      publishedSessions.forEach((session) => livePracticePublished.current.add(session));
      if (newlyPublished.length) {
        setLiveAnnouncement(`${newlyPublished.join(", ")} results published`);
        setLiveHighlight(true);
      }
      setPracticeBest((current) => {
        const updated = buildPracticeBest(practicePayloads);
        if (!current) return updated;
        const published = new Set(updated.published);
        return {
          rows: [...current.rows.filter((entry) => !published.has(entry.session)), ...updated.rows],
          published: [...new Set([...current.published, ...updated.published])],
          unpublished: updated.unpublished.filter((entry) => !current.published.includes(entry.session)),
          failed: updated.failed.filter((entry) => !current.published.includes(entry.session)),
        };
      });
    }
    setLiveNow(Date.now());
    setLiveResourceVersion((current) => current + 1);
  }, [round, season]);

  useEffect(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    const now = liveNow ?? 0;
    const window = raceWeekendWindow(weekendRace ?? nextRace);
    if (!liveActive || !liveOnline || !liveVisible || livePaused) {
      // A page left open before Friday wakes at the boundary without polling.
      if (!liveActive && window && now < window.start) liveTimer.current = setTimeout(() => setLiveNow(Date.now()), Math.min(window.start - now, 2_147_483_647));
      return;
    }
    const interval = nextLiveInterval([liveTtl], liveFailures);
    const delay = Math.min(interval, Math.max(0, (window?.end ?? now) - now));
    liveTimer.current = setTimeout(() => {
      if (window && Date.now() >= window.end) { setLiveNow(Date.now()); return; }
      void refreshLive();
    }, delay);
    return () => { if (liveTimer.current) clearTimeout(liveTimer.current); };
  }, [liveActive, liveFailures, liveNow, liveOnline, livePaused, liveTtl, liveVisible, nextRace, refreshLive, weekendRace]);

  useEffect(() => {
    const ready = liveActive && liveOnline && liveVisible && !livePaused;
    if (ready && liveWasInactive.current) {
      void refreshLive();
    }
    if (!ready && liveActive) liveWasInactive.current = true;
    if (ready) liveWasInactive.current = false;
    // Only a return from pause, hidden tab or offline triggers an immediate request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveActive, liveOnline, liveVisible, livePaused]);
  // Visible numbering is the official formula1.com round (cancelled rounds
  // excluded); `round` stays the internal API key.
  const selectedRoundLabel = officialRoundLabel(selectedRace);
  const requiredDatasets = ingestionReadiness?.datasets.filter((dataset) => dataset.required) ?? [];
  const availableDatasetCount = requiredDatasets.filter((dataset) => dataset.status === "available").length;
  const unavailableDatasetNames = requiredDatasets
    .filter((dataset) => dataset.status !== "available")
    .map((dataset) => dataset.dataset.replaceAll("_", " "));
  // "available" per dataset only means the rows landed; it does not mean the
  // driver identities in those rows passed the cross-check. Only trust the
  // count as ready once the API's own integrity_status says so.
  const integrityVerified = ingestionReadiness?.integrity_status === "ready";
  const datasetCoverageReady =
    requiredDatasets.length > 0 && availableDatasetCount === requiredDatasets.length && integrityVerified;
  const datasetCoverageSuffix =
    ingestionReadiness?.integrity_status === "identity_mismatch"
      ? " — identity check failed"
      : integrityVerified
        ? ""
        : " — unverified";
  const datasetCoverageValue = requiredDatasets.length
    ? `${availableDatasetCount}/${requiredDatasets.length} available${datasetCoverageSuffix}`
    : "Not supplied";
  const circuitByName = useMemo(
    () => new Map(circuits.map((circuit) => [normalizeCircuitName(circuit.name), circuit.id])),
    [circuits],
  );
  const raceForCircuit = useMemo(() => {
    const map = new Map<number, APICalendarRace>();
    for (const race of calendar) {
      const name = race.circuit?.name == null ? undefined : normalizeCircuitName(race.circuit.name);
      const id = name == null ? undefined : circuitByName.get(name);
      if (id != null && !map.has(id)) map.set(id, race);
    }
    return map;
  }, [calendar, circuitByName]);
  const teams = useMemo(
    () => Array.from(new Set(standings.map((driver) => driver.team_name))).sort(),
    [standings],
  );
  const rows = useMemo(
    () => buildRows(standings, results, predictions),
    [standings, results, predictions],
  );
  const selectedStandingRows = useMemo(
    () => buildRows(standings, [], null).filter((row) => selectedDrivers.includes(row.id)),
    [selectedDrivers, standings],
  );
  const selectedComparisonRows = useMemo(
    () => buildRows(standings, results, predictions).filter((row) => selectedDrivers.includes(row.id)),
    [predictions, results, selectedDrivers, standings],
  );
  const driverHeadToHead = useMemo(
    () => buildDriverHeadToHead(selectedComparisonRows),
    [selectedComparisonRows],
  );

  useEffect(() => {
    if (typeof window === "undefined" || urlStateReady) return;
    const params = new URLSearchParams(window.location.search);
    const urlRound = Number(params.get("round"));
    const urlMetric = params.get("metric") as Metric;
    const urlTeam = params.get("team");
    const urlQuery = params.get("q");
    const urlSeason = Number(params.get("season"));
    const urlSession = params.get("session") as SessionView;
    const urlComparisonDriver = params.get("compareDriver");
    const urlDriversParam = params.get("drivers");
    const urlDrivers = urlDriversParam == null
      ? null
      : urlDriversParam.split(",").map(Number).filter(Number.isFinite);
    const urlCircuit = params.get("circuit");
    if (AVAILABLE_SEASONS.includes(urlSeason) && urlSeason !== seasonRef.current) {
      changeSeason(urlSeason);
      return;
    }
    if (isLoadingSeason || calendarSeason !== seasonRef.current) return;
    if (calendar.some((race) => race.round === urlRound)) changeRound(urlRound);
    if (metricDefinitions.some((item) => item.key === urlMetric)) setMetric(urlMetric);
    if (urlTeam && (urlTeam === "all" || teams.includes(urlTeam))) setTeamFilter(urlTeam);
    if (urlQuery) setQuery(urlQuery);
    if (["race", "practice", "qualifying", "qualifyingPrediction", "telemetry"].includes(urlSession)) {
      setSessionView(urlSession);
    }
    if (urlComparisonDriver && /^\d+$/.test(urlComparisonDriver)) {
      setComparisonDriver(urlComparisonDriver);
      setHasExplicitComparisonDriver(true);
    }
    if (urlDrivers != null) {
      setHasCustomDrivers(true);
      changeSelectedDrivers(urlDrivers);
    }
    // Links shared before the workspace named a circuit, not a race.
    const circuitRace = urlCircuit && /^\d+$/.test(urlCircuit) ? raceForCircuit.get(Number(urlCircuit)) : undefined;
    if (circuitRace && !calendar.some((race) => race.round === urlRound)) changeRound(circuitRace.round);
    const urlView = params.get("view");
    const hashView = LAB_VIEWS.find((item) => `#${item.anchor}` === window.location.hash)?.id;
    const hasRace = roundRef.current != null;
    setView(isLabViewId(urlView) ? urlView : hashView ?? defaultLabView(hasRace));
    historyModeRef.current = "replace";
    setUrlStateReady(true);
  }, [calendar, calendarSeason, changeRound, changeSeason, changeSelectedDrivers, isLoadingSeason, raceForCircuit, teams, urlStateReady]);

  useEffect(() => {
    const seasonTransition = transitionInitialSeasonRestore(
      season,
      initialSeason,
      hasVisitedArchiveSeasonRef.current,
    );
    hasVisitedArchiveSeasonRef.current = seasonTransition.hasVisitedArchive;
    if (season === initialSeason) {
      if (!seasonTransition.restore) {
        setIsLoadingSeason(false);
        return;
      }
      setCalendar(initialCalendar);
      setCalendarSeason(initialSeasonError ? null : initialSeason);
      setStandings(initialStandings);
      setSeasonError(initialSeasonError ? "Season data is unavailable from the live API." : null);
      setSeasonStandings((current) => ({ ...current, [initialSeason]: initialStandings }));
      roundRef.current = defaultRound;
      setRound(roundRef.current);
      setTeamFilter("all");
      setIsLoadingRace(defaultRound != null);
      setIsLoadingSession(defaultRound != null);
      setIsLoadingSeason(false);
      return;
    }
    let cancelled = false;
    clearStarterAnswer();
    setIsLoadingSeason(true);
    setSeasonError(null);
    Promise.all([
      fetchLab<APICalendarRace[]>(`/v1/f1/calendar/${season}`),
      fetchLab<LabStanding[]>(`/v1/f1/standings/drivers/${season}`),
    ])
      .then(([nextCalendar, nextStandings]) => {
        if (cancelled) return;
        clearStarterAnswer();
        setSeasonError(null);
        const nextRaces = sortRacesChronologically(Array.isArray(nextCalendar.data) ? nextCalendar.data : []);
        setCalendar(nextRaces);
        setCalendarSeason(season);
        const nextSeasonStandings = Array.isArray(nextStandings.data) ? nextStandings.data : [];
        setStandings(nextSeasonStandings);
        setSeasonStandings((current) => ({ ...current, [season]: nextSeasonStandings }));
        setSeasonTimestamps((current) => ({ ...current, [season]: nextStandings.timestamp ?? nextCalendar.timestamp }));
        const nextRound = nextRaces.some((race) => race.round === roundRef.current)
          ? roundRef.current
          : lastCompletedRound(nextRaces);
        if (nextRound == null) {
          setIsLoadingRace(false);
          setIsLoadingSession(false);
        } else {
          changeRound(nextRound);
        }
        setTeamFilter("all");
      })
      .catch(() => {
        if (!cancelled) {
          clearStarterAnswer();
          setCalendar([]);
          setCalendarSeason(null);
          setStandings([]);
          changeRound(null);
          setIsLoadingRace(false);
          setIsLoadingSession(false);
          setSeasonError("Season data is unavailable from the live API.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          clearStarterAnswer();
          setIsLoadingSeason(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [changeRound, clearStarterAnswer, defaultRound, initialCalendar, initialSeason, initialSeasonError, initialStandings, season]);

  useEffect(() => {
    if (round == null) return;
    if (!raceSelectionChangedRef.current && season === initialSeason && round === initialRound && !initialRaceError) {
      // Server-rendered payload for this race: no second request.
      return;
    }
    let cancelled = false;
    clearStarterAnswer();
    setIsLoadingRace(true);
    setRaceError(null);
    setResults([]);
    setPredictions(null);
    setSourceTimestamp(null);
    Promise.allSettled([
      fetchLab<LabResult[]>(`/v1/f1/races/${season}/${round}/results`),
      fetchLab<APIRacePredictions>(`/v1/f1/predictions/race/${season}/${round}`),
      fetchLab<IngestionReadiness>(
        `/v1/f1/races/${season}/${round}/ingestion-readiness`,
      ),
    ])
      .then(([resultsResult, predictionsResult, readinessResult]) => {
        if (cancelled) return;
        if (resultsResult.status !== "fulfilled") {
          throw new Error("Race results are unavailable");
        }
        clearStarterAnswer();
        setRaceError(null);
        setResults(resultsResult.value.data ?? []);
        setPredictions(
          predictionsResult.status === "fulfilled"
            ? predictionsResult.value.data ?? null
            : null,
        );
        setIngestionReadiness(
          readinessResult.status === "fulfilled"
            ? readinessResult.value.data ?? null
            : null,
        );
        setSourceTimestamp(
          resultsResult.value.timestamp
            ?? (predictionsResult.status === "fulfilled"
              ? predictionsResult.value.timestamp
              : null),
        );
      })
      .catch(() => {
        if (!cancelled) {
          clearStarterAnswer();
          setIngestionReadiness(null);
          setRaceError("Race data is unavailable from the live API.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          clearStarterAnswer();
          setIsLoadingRace(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearStarterAnswer, initialRaceError, initialRound, initialSeason, round, season]);

  useEffect(() => {
    if (round == null) return;
    let cancelled = false;
    clearStarterAnswer();
    setIsLoadingSession(true);
    setSessionError(null);
    setPracticeBest(null);
    setQualifying(null);
    setQualifyingPrediction(null);
    setQualifyingWithheld(false);
    // Each payload settles on its own: one withheld or failing session must
    // not blank the others. A failure becomes an explicit, surfaced state.
    const settle = <T,>(request: Promise<LabPayload<T>>) =>
      request.then(
        (payload) => ({ ...payload, failedStatus: null as number | null }),
        (error: unknown) => ({
          data: null as T | null,
          timestamp: null,
          meta: null,
          failedStatus: error instanceof LabAPIError ? error.status : 0,
        }),
      );
    // Practice best laps come from the per-session classification endpoints:
    // the API takes each driver's minimum over every lap, whereas the raw
    // /practice list is paginated (100 rows by default) and would silently
    // drop drivers on later pages.
    Promise.all([
      Promise.all(PRACTICE_SESSIONS.map((session) => settle(fetchLab<unknown>(`/v1/f1/races/${season}/${round}/practice/${session}/best`)))),
      settle(fetchLab<LabQualifyingResult[] | null>(`/v1/f1/races/${season}/${round}/qualifying`)),
      settle(fetchLab<LabQualifyingPrediction[] | null>(`/v1/f1/predictions/qualifying/${season}/${round}`)),
    ])
      .then(([nextPractice, nextQualifying, nextPrediction]) => {
        if (cancelled) return;
        clearStarterAnswer();
        const practiceFailed = nextPractice.every((payload) => payload.failedStatus !== null);
        if (practiceFailed && nextQualifying.failedStatus !== null && nextPrediction.failedStatus !== null) {
          setSessionError("Session data is unavailable from the API.");
        } else {
          setSessionError(null);
        }
        const initialPractice = buildPracticeBest(nextPractice.map((payload, index) => ({
          session: PRACTICE_SESSIONS[index],
          status: payload.failedStatus !== null ? "error" : "ready",
          data: payload.data,
          errorStatus: payload.failedStatus,
        })));
        initialPractice.published.forEach((session) => livePracticePublished.current.add(session));
        setPracticeBest(initialPractice);
        setQualifying(Array.isArray(nextQualifying.data) ? nextQualifying.data : []);
        livePublished.current = Array.isArray(nextQualifying.data) && nextQualifying.data.length > 0;
        setQualifyingPrediction(Array.isArray(nextPrediction.data) ? nextPrediction.data : []);
        setQualifyingWithheld(nextQualifying.failedStatus === 409);
        const practiceWithMeta = nextPractice.find((payload) => payload.meta?.data_fetched_at) ?? nextPractice.find((payload) => payload.meta);
        setSessionTimestamp(practiceWithMeta?.timestamp ?? nextQualifying.timestamp ?? nextPrediction.timestamp);
        setSessionSourceMeta(practiceWithMeta?.meta ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          clearStarterAnswer();
          setPracticeBest(null);
          setQualifying([]);
          setQualifyingPrediction([]);
          setQualifyingWithheld(false);
          setSessionTimestamp(null);
          setSessionSourceMeta(null);
          setSessionError("Session data is unavailable from the API.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          clearStarterAnswer();
          setIsLoadingSession(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearStarterAnswer, round, season]);

  useEffect(() => {
    // Historical standings are read only for the "Across seasons" view.
    if (view !== "seasons") return;
    const targetSeasons = [season, initialSeason, ...Array.from({ length: 6 }, (_, i) => LIVE_SEASON - i)].filter((y, i, a) => a.indexOf(y) === i);
    const missingSeasons = targetSeasons.filter((year) => seasonStandings[year] == null);
    if (missingSeasons.length === 0) return;
    let cancelled = false;
    Promise.allSettled(missingSeasons.map(async (year) => [year, await fetchLab<LabStanding[]>(`/v1/f1/standings/drivers/${year}`)] as const))
      .then((entries) => {
        if (cancelled) return;
        setSeasonStandings((current) => {
          const next = { ...current };
          let changed = false;
          entries.forEach((entry, index) => {
            if (entry.status !== "fulfilled") return;
            const year = missingSeasons[index];
            next[year] = Array.isArray(entry.value[1].data) ? entry.value[1].data : [];
            changed = true;
          });
          return changed ? next : current;
        });
        setSeasonTimestamps((current) => {
          const next = { ...current };
          let changed = false;
          entries.forEach((entry, index) => {
            if (entry.status !== "fulfilled") return;
            const year = missingSeasons[index];
            next[year] = entry.value[1].timestamp;
            changed = true;
          });
          return changed ? next : current;
        });
        setSeasonLoadErrors((current) => {
          const next = { ...current };
          entries.forEach((entry, index) => {
            const year = missingSeasons[index];
            if (entry.status === "rejected") next[year] = true;
            else delete next[year];
          });
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [initialSeason, season, seasonStandings, seasonTimestamps, view]);

  const labQuery = useCallback((nextView: LabViewId) => {
    const params = new URLSearchParams();
    params.set("view", nextView);
    params.set("season", String(season));
    if (round != null) params.set("round", String(round));
    // Keep default comparison state out of shared URLs. Persist it only when
    // it was explicitly shared or changed by the user.
    if (hasCustomDrivers) params.set("drivers", selectedDrivers.join(","));
    if (metric !== "seasonPoints") params.set("metric", metric);
    if (sessionView !== "race") params.set("session", sessionView);
    if (teamFilter !== "all") params.set("team", teamFilter);
    if (query.trim()) params.set("q", query.trim());
    if (comparisonDriver && hasExplicitComparisonDriver) params.set("compareDriver", comparisonDriver);
    return `?${params.toString()}`;
  }, [comparisonDriver, hasCustomDrivers, hasExplicitComparisonDriver, metric, query, round, season, selectedDrivers, sessionView, teamFilter]);

  useEffect(() => {
    if (typeof window === "undefined" || !urlStateReady) return;
    const next = `${window.location.pathname}${labQuery(view)}`;
    const mode = historyModeRef.current;
    historyModeRef.current = "replace";
    if (next === `${window.location.pathname}${window.location.search}`) return;
    if (mode === "push") window.history.pushState(null, "", next);
    else window.history.replaceState(null, "", next);
  }, [labQuery, urlStateReady, view]);

  // Back and Forward re-read the URL: view, season, race and drivers.
  useEffect(() => {
    const onPopState = () => {
      historyModeRef.current = "replace";
      focusViewRef.current = true;
      setUrlStateReady(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const next = rows.filter((row) => {
      const matchesQuery = !normalizedQuery || `${row.name} ${row.code} ${row.team}`.toLowerCase().includes(normalizedQuery);
      const matchesTeam = teamFilter === "all" || row.team === teamFilter;
      return matchesQuery && matchesTeam;
    });
    return next.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      if (sortMode === "metric") {
        const aValue = getMetricValue(a, metric);
        const bValue = getMetricValue(b, metric);
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        return metric === "raceFinish" || metric === "grid" ? aValue - bValue : bValue - aValue;
      }
      return (a.seasonPosition ?? 999) - (b.seasonPosition ?? 999);
    });
  }, [metric, query, rows, sortMode, teamFilter]);

  const chartRows = useMemo(
    () => filteredRows.filter((row) => getMetricValue(row, metric) != null),
    [filteredRows, metric],
  );
  const hasRaceData = results.length > 0;
  const predictionCount = predictions?.predictions?.length ?? 0;
  const metricAvailability = useMemo<Record<Metric, boolean>>(
    () => ({
      seasonPoints: standings.some((driver) => driver.points != null),
      raceFinish: results.some((result) => result.position != null),
      grid: results.some((result) => result.grid != null),
      laps: results.some((result) => result.laps != null),
      winProbability: predictionCount > 0,
    }),
    [predictionCount, results, standings],
  );
  const practiceRows = practiceBest?.rows ?? [];
  const comparisonOptions = useMemo<ComparisonDriver[]>(() => {
    const byId = new Map<number, ComparisonDriver>();
    for (const driver of Object.values(seasonStandings).flatMap((items) => Array.isArray(items) ? items : [])) {
      byId.set(driver.driver_id, {
        id: driver.driver_id,
        name: `${driver.first_name} ${driver.last_name}`,
        tla: driverTla(driver.first_name, driver.last_name),
      });
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [seasonStandings]);
  const comparisonRows = useMemo(() => {
    const allRows = AVAILABLE_SEASONS.map((year) => ({
      year,
      standing: seasonStandings[year]?.find((driver) => String(driver.driver_id) === comparisonDriver) ?? null,
      timestamp: seasonTimestamps[year] ?? null,
      unavailable: seasonLoadErrors[year] === true,
    }));
    if (comparisonDriver) {
      const active = allRows.filter((r) => r.standing != null);
      return active.length > 0 ? active : allRows.slice(0, 5);
    }
    return allRows.slice(0, 5);
  }, [comparisonDriver, seasonLoadErrors, seasonStandings, seasonTimestamps]);
  const historicalSeasonError = Object.keys(seasonLoadErrors).length > 0
    ? "Some historical standings are unavailable from the live API."
    : null;

  useEffect(() => {
    if (!urlStateReady || hasExplicitComparisonDriver || comparisonDriver) return;
    if (standings[0]?.driver_id != null) setComparisonDriver(String(standings[0].driver_id));
  }, [comparisonDriver, hasExplicitComparisonDriver, standings, urlStateReady]);

  useEffect(() => {
    if (!metricAvailability[metric]) {
      const nextMetric = metricDefinitions.find((item) => metricAvailability[item.key]);
      if (nextMetric) setMetric(nextMetric.key);
    }
  }, [metric, metricAvailability]);

  function toggleDriver(driverId: number) {
    setHasCustomDrivers(true);
    changeSelectedDrivers(selectedDrivers.includes(driverId)
      ? selectedDrivers.filter((id) => id !== driverId)
      : [...selectedDrivers, driverId].slice(-4));
  }

  async function askQuestion(nextQuestion = question) {
    const text = nextQuestion.trim();
    if (!text || isAsking) return;
    setQuestion(text);
    const isStarterQuestion = starterQuestions.includes(text);
    if (isStarterQuestion && (isLoadingSeason || isLoadingRace || isLoadingSession || seasonError || raceError || sessionError)) {
      answerKindRef.current = null;
      setAnswer(null);
      return;
    }
    const localAnswer = buildStarterAnswer(text, {
      season,
      round,
      roundLabel: selectedRoundLabel ?? (selectedRace ? raceLabel(selectedRace.name) : undefined),
      selectedRows: selectedStandingRows,
      results,
      practiceCount: practiceRows.length,
      qualifyingCount: qualifying?.length ?? 0,
      qualifyingPredictionCount: qualifyingPrediction?.length ?? 0,
      racePredictionCount: predictionCount,
    });
    if (localAnswer) {
      answerKindRef.current = "starter";
      setAnswer(localAnswer);
      return;
    }
    const requestId = chatRequestGateRef.current.begin();
    answerKindRef.current = null;
    setIsAsking(true);
    setAnswer(null);
    try {
      const response = await fetch(`${LAB_PROXY_BASE}/v1/f1/chat`, {
        signal: AbortSignal.timeout(25_000),
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok) throw new Error("Chat endpoint unavailable");
      const raw = await response.json();
      if (!chatRequestGateRef.current.isCurrent(requestId)) return;
      answerKindRef.current = "chat";
      setAnswer(normalizeChatPayload(raw));
    } catch {
      if (!chatRequestGateRef.current.isCurrent(requestId)) return;
      answerKindRef.current = "chat";
      setAnswer({ answer: "The grounded question endpoint is unavailable right now.", sources: [] });
    } finally {
      if (chatRequestGateRef.current.isCurrent(requestId)) setIsAsking(false);
    }
  }

  function handleStarterQuestion(starter: string) {
    if (isAsking) return;
    setQuestion(starter);
    void askQuestion(starter);
  }

  const activeMetric = metricDefinitions.find((item) => item.key === metric) ?? metricDefinitions[0];
  const raceShortName = selectedRace ? raceLabel(selectedRace.name) : null;
  const raceScopeLabel = selectedRace
    ? `${selectedRoundLabel ? `${selectedRoundLabel} · ` : ""}${raceShortName}`
    : null;
  const filterParts = [
    teamFilter !== "all" ? `team: ${teamFilter}` : null,
    query.trim() ? `search: “${query.trim()}”` : null,
  ].filter(Boolean);
  const filterLabel = filterParts.length ? filterParts.join(" · ") : "no filter";
  const fieldTitle = metric === "seasonPoints"
    ? "Championship points, season to date"
    : `${activeMetric.label}${raceScopeLabel ? ` · ${raceScopeLabel}` : ""}`;
  const fieldScope = [
    metric === "seasonPoints"
      ? `${season} standings · all completed rounds · independent of the race selected`
      : metric === "winProbability"
        ? `${season} pre-race forecast`
        : `${season} race classification`,
    `${chartRows.length} of ${rows.length} drivers`,
    filterLabel,
  ].join(" · ");
  const standingsEndpoint = `/v1/f1/standings/drivers/${season}`;
  const resultsEndpoint = round == null ? null : `/v1/f1/races/${season}/${round}/results`;
  const predictionsEndpoint = round == null ? null : `/v1/f1/predictions/race/${season}/${round}`;
  const fieldEndpoints = (metric === "seasonPoints"
    ? [standingsEndpoint]
    : metric === "winProbability"
      ? [predictionsEndpoint]
      : [resultsEndpoint]).filter((endpoint): endpoint is string => endpoint != null);
  const tableEndpoints = [standingsEndpoint, resultsEndpoint, predictionsEndpoint].filter((endpoint): endpoint is string => endpoint != null);
  const roundSlug = selectedRoundLabel ?? raceShortName;
  const fieldExportRows = filteredRows.map((row) => ({
    season,
    race: raceScopeLabel,
    driver_code: row.code,
    driver: row.name,
    team: row.team,
    season_position: row.seasonPosition,
    season_points: row.seasonPoints,
    wins: row.wins,
    race_finish: row.racePosition,
    grid: row.grid,
    laps: row.laps,
    status: row.status,
    win_probability: row.winProbability,
  }));
  const selectedDriverRefs = selectedDrivers.flatMap((id) => {
    const row = selectedComparisonRows.find((item) => item.id === id);
    return row ? [{ id: row.id, code: row.code, name: row.name, team: row.team }] : [];
  });
  const viewContext: LabViewContext = {
    season,
    round,
    raceLabel: raceScopeLabel,
    roundSlug,
    races: calendar.map((race) => ({
      round: race.round,
      label: officialRoundLabel(race) ?? raceLabel(race.name),
      sprintWeekend: Boolean(race.is_sprint),
      completed: race.status === "completed",
    })),
    results,
    standings,
    selectedDrivers: selectedDriverRefs,
    raceIsLoading: isLoadingRace,
  };

  const selectRace = useCallback((nextRound: number) => {
    if (!calendar.some((race) => race.round === nextRound) || roundRef.current === nextRound) return;
    historyModeRef.current = "push";
    changeRound(nextRound);
  }, [calendar, changeRound]);

  const selectSeason = useCallback((nextSeason: number) => {
    historyModeRef.current = "push";
    changeSeason(nextSeason);
  }, [changeSeason]);

  const selectView = useCallback((nextView: LabViewId) => {
    focusViewRef.current = true;
    if (nextView === view) {
      document.getElementById(labViewDef(nextView).anchor)?.querySelector<HTMLElement>("h1")?.focus();
      return;
    }
    historyModeRef.current = "push";
    setView(nextView);
  }, [view]);

  // After a view change: bring the workspace top into sight if the page was
  // scrolled, then move focus to the new view's heading (a view still loading
  // in the browser hands focus over when it mounts, see ViewCard).
  useEffect(() => {
    if (!focusViewRef.current) return;
    focusViewRef.current = false;
    const workspace = workspaceRef.current;
    if (workspace && workspace.getBoundingClientRect().top < 0) {
      workspace.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
    const target = document.getElementById(labViewDef(view).anchor);
    if (!target) return;
    if (target.hasAttribute("data-view-placeholder")) {
      workspace?.setAttribute("data-focus-pending", "true");
      return;
    }
    const heading = target.querySelector<HTMLElement>("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [reducedMotion, view]);

  const commands = useMemo<CommandItem[]>(() => [
    ...LAB_VIEWS.map((item) => ({
      id: `view-${item.id}`,
      group: "Views",
      label: item.label,
      hint: item.group,
      keywords: item.keywords,
      run: () => selectView(item.id),
    })),
    ...metricDefinitions.filter((item) => metricAvailability[item.key]).map((item) => ({
      id: `metric-${item.key}`,
      group: "Field lens",
      label: `Field view: ${item.label}`,
      hint: item.short,
      run: () => {
        setMetric(item.key);
        selectView("field");
      },
    })),
    ...calendar.map((race) => ({
      id: `race-${race.round}`,
      group: `Races · ${season}`,
      label: `${officialRoundLabel(race) ? `${officialRoundLabel(race)} · ` : ""}${raceLabel(race.name)}`,
      hint: race.status,
      keywords: `${race.circuit?.name ?? ""} ${race.circuit?.country ?? ""} race grand prix`,
      run: () => selectRace(race.round),
    })),
    ...standings.map((driver) => ({
      id: `driver-${driver.driver_id}`,
      group: "Drivers · add to comparison",
      label: `${driver.first_name} ${driver.last_name}`,
      hint: `${driver.driver_code ?? ""} · ${driver.team_name}`,
      keywords: `${driver.team_name} driver`,
      run: () => {
        setHasCustomDrivers(true);
        if (!selectedDriversRef.current.includes(driver.driver_id)) {
          changeSelectedDrivers([...selectedDriversRef.current, driver.driver_id].slice(-4));
        }
      },
    })),
    ...AVAILABLE_SEASONS.slice(0, 12).map((year) => ({
      id: `season-${year}`,
      group: "Seasons",
      label: `${year} season`,
      hint: year === LIVE_SEASON ? "live" : "archive",
      run: () => selectSeason(year),
    })),
  ], [calendar, changeSelectedDrivers, metricAvailability, season, selectRace, selectSeason, selectView, standings]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (paletteOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = target != null
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        if (view !== "field") {
          historyModeRef.current = "push";
          setView("field");
        }
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => findInputRef.current?.focus()));
      } else if (event.key === "[" || event.key === "]") {
        const index = calendar.findIndex((race) => race.round === roundRef.current);
        const next = calendar[index + (event.key === "]" ? 1 : -1)];
        if (index >= 0 && next) {
          event.preventDefault();
          selectRace(next.round);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [calendar, paletteOpen, selectRace, view]);

  const sessionEndpoints = round == null
    ? []
    : sessionView === "practice"
      ? PRACTICE_SESSIONS.map((session) => `/v1/f1/races/${season}/${round}/practice/${session}/best`)
      : [sessionView === "qualifying"
        ? `/v1/f1/races/${season}/${round}/qualifying`
        : sessionView === "qualifyingPrediction"
          ? `/v1/f1/predictions/qualifying/${season}/${round}`
          : sessionView === "telemetry"
            ? (selectedDriverRefs[0] ? `/v1/f1/races/${season}/${round}/telemetry/${selectedDriverRefs[0].id}` : null)
            : resultsEndpoint].filter((endpoint): endpoint is string => endpoint != null);
  const sessionExportRows = sessionView === "practice"
    ? practiceRows.map((row) => ({ season, race: raceScopeLabel, session: row.session, rank: row.rank, driver_code: row.driverCode, driver: row.driver, best_lap_ms: row.bestMs, gap_ms: row.gapMs }))
    : sessionView === "qualifying"
      ? (qualifying ?? []).map((row) => ({ season, race: raceScopeLabel, position: row.position, driver: `${row.first_name} ${row.last_name}`, team: row.team, q1: row.q1, q2: row.q2, q3: row.q3 }))
      : sessionView === "qualifyingPrediction"
        ? (qualifyingPrediction ?? []).map((row) => ({ season, race: raceScopeLabel, rank: row.position, driver: row.driver_name, expected_position: row.expected_position, p_pole: row.p_pole, p_q3: row.p_q3 }))
        : sessionView === "race"
          ? fieldExportRows
          : [];
  const comparisonExportRows = comparisonRows.map(({ year, standing, unavailable }) => ({
    season: year,
    driver: standing ? `${standing.first_name} ${standing.last_name}` : null,
    position: unavailable ? null : standing?.position ?? null,
    points: standing?.points ?? null,
    wins: standing?.wins ?? null,
    state: unavailable ? "unavailable" : standing ? "classified" : "not in season",
  }));
  const headToHeadExportRows = driverHeadToHead.map((driver) => ({
    season,
    race: raceScopeLabel,
    driver_code: driver.code,
    driver: driver.name,
    team: driver.team,
    ...Object.fromEntries(Object.entries(driver.metrics).map(([key, value]) => [key, String(value)])),
  }));

  // ── Workspace bar: session status ──────────────────────────────────
  const upcomingRace = liveNow == null ? nextRace : nextRaceAfter(initialCalendar, liveNow);
  const upcomingStart = raceStartMs(upcomingRace);
  const countdown = liveNow != null && upcomingStart != null ? formatCountdown(upcomingStart - liveNow) : null;
  const relativeFreshness = relativeUpdate(liveTimestamp, liveNow ?? 0);
  const followWeekend = weekendRace != null && !liveActive && season === initialSeason ? weekendRace : null;
  const statusTone = liveActive
    ? liveStatus === "Live" ? "border-teal/30 text-light" : "border-amber-400/30 text-amber-400"
    : "border-amber-400/30 text-amber-400";

  const sessionStatus = (
    <div
      className={`flex min-h-6 items-center gap-x-2 rounded-lg border-transparent py-0.5 text-[13px] transition-colors duration-200 lg:min-h-10 lg:border lg:px-2 lg:py-1.5 ${liveHighlight && !reducedMotion ? "bg-teal/[0.08]" : ""} ${statusTone}`}
      data-testid="lab-live-status"
      data-live-next-interval={liveActive ? nextLiveInterval([liveTtl], liveFailures) : undefined}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${liveActive && liveStatus === "Live" ? "bg-teal" : "bg-amber-400"}`} />
      {liveActive ? (
        <>
          <span className="font-medium">{liveStatus}</span>
          {relativeFreshness && <span className="text-white/[0.70]">{relativeFreshness}</span>}
          <button type="button" onClick={() => setLivePaused((paused) => !paused)} className="min-h-11 rounded-md border border-white/[0.14] px-2 text-[13px] text-white/[0.84] hover:border-white/[0.3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 lg:min-h-8">{livePaused ? "Resume" : "Pause"}</button>
          <button type="button" onClick={() => void refreshLive()} disabled={!liveOnline || liveInFlight.current} className="min-h-11 rounded-md border border-white/[0.14] px-2 text-[13px] text-white/[0.84] hover:border-white/[0.3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 disabled:opacity-50 lg:min-h-8">Refresh now</button>
        </>
      ) : followWeekend ? (
        <>
          <span>Race weekend · {raceLabel(followWeekend.name)}</span>
          <button type="button" onClick={() => selectRace(followWeekend.round)} className="min-h-11 rounded-md border border-amber-400/35 px-2 text-[13px] lg:min-h-8 hover:bg-amber-400/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70">Follow live</button>
        </>
      ) : upcomingRace ? (
        <span className="min-w-0 whitespace-nowrap" title={upcomingRace.name}>
          Next: {raceLabel(upcomingRace.name)}
          <span className="hidden sm:inline">{formatRaceDay(upcomingRace) ? ` · ${formatRaceDay(upcomingRace)}` : ""}{countdown ? ` · in ${countdown}` : ""}</span>
        </span>
      ) : (
        <span>No upcoming race in the calendar</span>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
    </div>
  );

  async function shareView() {
    const copied = await copyText(window.location.href);
    setShareState(copied ? "copied" : "failed");
    window.setTimeout(() => setShareState("idle"), 2_000);
  }

  // ── Race report data ───────────────────────────────────────────────
  const lastCompleted = [...calendar].reverse().find((race) => race.status === "completed") ?? null;
  const reportRace = selectedRace
    ? {
        round: selectedRace.round,
        name: selectedRace.name,
        date: selectedRace.date,
        officialRound: selectedRoundLabel,
        circuit: selectedRace.circuit,
        completed: selectedRace.status === "completed",
      }
    : null;
  const coverage = (
    <dl className="mt-6 grid gap-x-6 gap-y-1.5 border-t border-white/[0.06] pt-4 text-[13px] sm:grid-cols-2" aria-label="Data coverage and provenance" data-provenance>
      {([
        ["Race payload", round == null ? "Unavailable" : `${season} / ${selectedRoundLabel ?? raceLabel(selectedRace?.name ?? "race")}`, round != null],
        ["Race results", hasRaceData ? `${results.length} rows` : "Unavailable", hasRaceData],
        ["Win forecast", predictionCount ? `${predictionCount} rows` : "No forecast", predictionCount > 0],
        ["Source timestamp", formatSourceTimestamp(sourceTimestamp), sourceTimestamp != null],
        ["Dataset coverage", datasetCoverageValue, datasetCoverageReady],
        ["Projection freshness", formatSourceTimestamp(ingestionReadiness?.projection.projected_at ?? null), ingestionReadiness?.projection.projected_at != null],
        ["Unavailable datasets", unavailableDatasetNames.length ? unavailableDatasetNames.join(", ") : "None", unavailableDatasetNames.length === 0 && requiredDatasets.length > 0],
      ] as [string, string, boolean][]).map(([label, value, ready]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-white/[0.66]">{label}</dt>
          <dd className={`text-right ${ready ? "text-white/[0.86]" : "text-amber-400"}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );

  // ── Inspector shortcuts (ready-made analyses) ───────────────────────
  const leaderTeam = [...standings].sort((a, b) => (a.position ?? 999) - (b.position ?? 999))[0]?.team_name;
  const leaderTeammates = standings.filter((driver) => driver.team_name === leaderTeam).slice(0, 2);
  const shortcuts: InspectorShortcut[] = [
    ...(leaderTeammates.length === 2 ? [{
      id: "teammates",
      label: `Compare teammates: ${leaderTeammates.map((driver) => driver.driver_code ?? driver.last_name).join(" and ")}`,
      run: () => {
        setHasCustomDrivers(true);
        changeSelectedDrivers(leaderTeammates.map((driver) => driver.driver_id));
        selectView("h2h");
      },
    }] : []),
    ...(lastCompleted ? [{
      id: "last-pace",
      label: "Race pace, last Grand Prix",
      run: () => {
        selectRace(lastCompleted.round);
        selectView("pace");
      },
    }] : []),
    ...(round != null ? [{ id: "timeline", label: "Safety cars and incidents, this race", run: () => selectView("timeline") }] : []),
    {
      id: "gain",
      label: STARTER_QUESTIONS.POSITION_GAIN,
      run: () => {
        selectView("ask");
        handleStarterQuestion(STARTER_QUESTIONS.POSITION_GAIN);
      },
    },
  ];

  // ── Views ──────────────────────────────────────────────────────────
  const metricButtons = (
    <div className="flex flex-wrap gap-1 rounded-lg border border-white/[0.08] p-1" role="tablist" aria-label="Measure">
      {metricDefinitions.map((item) => {
        const available = metricAvailability[item.key];
        return <button key={item.key} type="button" role="tab" aria-selected={metric === item.key} aria-disabled={!available} disabled={!available} title={available ? item.hint : `${item.label} unavailable from the live API for this race`} onClick={() => setMetric(item.key)} className={`min-h-11 rounded-md px-3 text-[13px] transition-colors lg:min-h-9 ${metric === item.key ? "bg-teal text-dark" : available ? "text-white/[0.78] hover:bg-white/[0.05] hover:text-light" : "cursor-not-allowed text-white/[0.62]"}`}>
          {item.short}
        </button>;
      })}
    </div>
  );
  const explorerTable = (
    <div className="overflow-x-auto" tabIndex={0} aria-label="Data explorer table">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px] text-white/[0.70]">Sort {(["position", "name", "metric"] as SortMode[]).map((mode) => <button key={mode} type="button" aria-pressed={sortMode === mode} onClick={() => setSortMode(mode)} className={`min-h-11 rounded-md border px-3 text-[13px] capitalize lg:min-h-9 ${sortMode === mode ? "border-white/[0.24] text-light" : "border-white/[0.08] text-white/[0.72] hover:text-light"}`}>{mode === "metric" ? activeMetric.short : mode}</button>)}</div>
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead><tr className={tableHead}><th scope="col" className="px-3 py-2">Driver</th><th scope="col" className="px-3 py-2">Team</th><th scope="col" className="px-3 py-2">Season pos.</th><th scope="col" className="px-3 py-2">Points</th><th scope="col" className="px-3 py-2">Race finish</th><th scope="col" className="px-3 py-2">Grid</th><th scope="col" className="px-3 py-2">Win %</th><th scope="col" className="px-3 py-2 text-right">Status</th></tr></thead>
        <tbody>{filteredRows.map((row) => { const isSelected = selectedDrivers.includes(row.id); return <tr key={row.id} className={`border-b border-white/[0.04] transition-colors hover:bg-white/[0.035] ${isSelected ? "bg-white/[0.04]" : ""}`}><td className="px-1 py-1"><button type="button" aria-label={`Select ${row.name} for comparison`} aria-pressed={isSelected} onClick={() => toggleDriver(row.id)} className={`min-h-11 rounded px-2 text-left text-[14px] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 ${isSelected ? "text-light" : "text-white/[0.84]"}`}><span>{row.name}</span><span className="ml-2 font-mono text-[12px]" style={{ color: readableTeamColor(row.team) }}>{row.code}</span></button></td><td className="px-3 py-2 text-[13px] text-white/[0.72]"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: teamColor(row.team) }} />{row.team}</span></td><td className={tableCell}>{row.seasonPosition ?? "—"}</td><td className={tableCell}>{formatValue("seasonPoints", row.seasonPoints)}</td><td className={tableCell}>{formatValue("raceFinish", row.racePosition)}</td><td className={tableCell}>{formatValue("grid", row.grid)}</td><td className={tableCell}>{formatValue("winProbability", row.winProbability)}</td><td className="px-3 py-2 text-right text-[13px] text-white/[0.70]">{row.status ?? "season data"}</td></tr>; })}</tbody>
      </table>
      {filteredRows.length === 0 && <p className="px-3 py-4 text-[14px] text-white/[0.70]">No rows match this query.</p>}
      <p className="mt-2 text-[12px] text-white/[0.62]">— means the API publishes no value for that cell (for example no race result for a driver who only appears in the standings).</p>
    </div>
  );

  function renderView() {
    switch (view) {
      case "report":
        return <RaceReportView context={viewContext} race={reportRace} isLatestCompleted={lastCompleted != null && lastCompleted.round === round} onSelectView={selectView} coverage={coverage} />;
      case "championship":
        return <ChampionshipView context={viewContext} />;
      case "constructors":
        return <ConstructorsView context={viewContext} />;
      case "pace":
        return <PaceView context={viewContext} />;
      case "fastest":
        return <FastestLapsView context={viewContext} />;
      case "strategy":
        return <StrategyView context={viewContext} />;
      case "positions":
        return <PositionsView context={viewContext} />;
      case "timeline":
        return <RaceTimelineView context={viewContext} />;
      case "field":
        return (
          <ViewCard
            id="lab-field"
            title={fieldTitle}
            scope={fieldScope}
            endpoints={fieldMode === "table" ? tableEndpoints : fieldEndpoints}
            source={{ source: "tdd", timestamp: metric === "seasonPoints" ? seasonTimestamps[season] ?? null : sourceTimestamp }}
            exportRows={fieldExportRows}
            exportName={exportBasename(`field-${metric}`, season, metric === "seasonPoints" ? null : roundSlug)}
            footnote="Select a driver (bar or table row) to add or remove it from the comparison."
            actions={
              <div className="flex rounded-md border border-white/[0.10] p-0.5" role="group" aria-label="Display">
                {(["chart", "table"] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={fieldMode === value} onClick={() => setFieldMode(value)} className={`min-h-10 rounded px-3 text-[13px] capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 lg:min-h-8 ${fieldMode === value ? "bg-teal text-dark" : "text-white/[0.72] hover:text-light"}`}>{value}</button>
                ))}
              </div>
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {metricButtons}
              <input ref={findInputRef} aria-label="Find a driver or team" aria-keyshortcuts="/" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a driver or team  /" className="control-input min-w-[200px] flex-1 sm:max-w-[260px]" />
              <select aria-label="Team filter" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="control-select sm:max-w-[200px]">
                <option value="all">All teams</option>
                {teams.map((team) => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>
            {fieldMode === "table" ? explorerTable : isLoadingRace && metric !== "seasonPoints" ? <ViewSkeleton label="Loading race data" rows={10} /> : raceError && metric !== "seasonPoints" ? <NotPublished title="Live data unavailable" detail={raceError} tone="amber" /> : chartRows.length === 0 ? <NotPublished title="No values for this measure" detail={`The API returned no ${activeMetric.label.toLowerCase()} for the current selection${filterParts.length ? ` and filter (${filterLabel})` : ""}.`} tone="amber" /> : (
              <TeamBars
                rows={chartRows.map((row, index) => ({
                  id: row.id,
                  rank: metric === "seasonPoints" ? row.seasonPosition ?? index + 1 : index + 1,
                  label: row.name.split(" ").at(-1) ?? row.name,
                  sub: row.team,
                  color: teamColor(row.team),
                  textColor: readableTeamColor(row.team),
                  value: getMetricValue(row, metric) as number,
                  display: formatValue(metric, getMetricValue(row, metric)),
                  selected: selectedDrivers.includes(row.id),
                }))}
                lowerIsBetter={metric === "raceFinish" || metric === "grid"}
                onToggle={(id) => toggleDriver(Number(id))}
                toggleLabel={(row) => `${row.selected ? "Remove" : "Add"} ${row.label} ${row.selected ? "from" : "to"} comparison`}
              />
            )}
          </ViewCard>
        );
      case "h2h":
        return (
          <ViewCard
            id="lab-head-to-head"
            title="Head-to-head"
            scope={`${raceScopeLabel ? `${season} · ${raceScopeLabel}` : season} · ${driverHeadToHead.length} selected drivers · missing values stay unavailable`}
            endpoints={tableEndpoints}
            source={{ source: "tdd", timestamp: sourceTimestamp }}
            exportRows={headToHeadExportRows}
            exportName={exportBasename("head-to-head", season, roundSlug)}
          >
            {driverHeadToHead.length < 2 ? (
              <NotPublished title="Select at least two drivers" detail="Add drivers with “+ Driver” in the bar above, or pick a ready-made comparison in the panel." />
            ) : (
              <>
                <div className="overflow-x-auto" tabIndex={0} aria-label="Head-to-head table">
                  <table className="w-full min-w-[720px] border-collapse text-left">
                    <thead>
                      <tr className={tableHead}>
                        <th scope="col" className="py-2 pr-4">Driver</th>
                        <th scope="col" className="px-3 py-2">Championship</th>
                        <th scope="col" className="px-3 py-2">Points</th>
                        <th scope="col" className="px-3 py-2">Wins</th>
                        <th scope="col" className="px-3 py-2">Grid</th>
                        <th scope="col" className="px-3 py-2">Finish</th>
                        <th scope="col" className="px-3 py-2">Win chance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {driverHeadToHead.map((driver) => (
                        <tr key={driver.id} className="border-b border-white/[0.04]">
                          <th scope="row" className="py-3 pr-4 font-normal">
                            <span className="block font-mono text-[12px]" style={{ color: readableTeamColor(driver.team) }}>{driver.code}</span>
                            <span className="mt-0.5 block text-[14px] text-white/[0.86]">{driver.name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-white/[0.66]"><span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: teamColor(driver.team) }} />{driver.team}</span>
                          </th>
                          {Object.entries(driver.metrics).map(([metricKey, value]) => (
                            <td key={metricKey} className={`px-3 py-3 font-mono text-[13px] tabular-nums ${value === "Unavailable" ? "text-amber-400" : "text-white/[0.86]"}`}>
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <HeadToHeadRecord context={viewContext} />
              </>
            )}
          </ViewCard>
        );
      case "sessions":
        return (
          <ViewCard
            id="lab-sessions"
            title="Race weekend sessions"
            scope={`${raceScopeLabel ? `${season} · ${raceScopeLabel}` : season} · ${sessionSourceMeta?.source === "openf1.org" ? "OpenF1 historical enrichment, non-official" : "official / API"}`}
            endpoints={sessionEndpoints}
            source={sessionSourceMeta ?? { source: "tdd", timestamp: sessionTimestamp }}
            exportRows={sessionExportRows}
            exportName={exportBasename(`session-${sessionView}`, season, roundSlug)}
          >
            <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Race weekend session">
              {([
                ["race", "Race", hasRaceData ? results.length : 0],
                ["practice", "Practice", practiceRows.length],
                ["qualifying", "Qualifying", qualifying?.length ?? 0],
                ["qualifyingPrediction", "Qualifying forecast", qualifyingPrediction?.length ?? 0],
                ["telemetry", "Telemetry", null],
              ] as [SessionView, string, number | null][]).map(([key, label, count]) => (
                <button key={key} type="button" role="tab" aria-selected={sessionView === key} onClick={() => setSessionView(key)} className={`min-h-11 rounded-md border px-3 text-[13px] lg:min-h-10 ${sessionView === key ? "border-white/[0.24] bg-white/[0.08] text-light" : "border-white/[0.08] text-white/[0.78] hover:text-light"}`}>
                  {label}
                  {count != null && <span className={`ml-2 font-mono text-[12px] tabular-nums ${count ? "text-white/[0.84]" : "text-white/[0.62]"}`}>{isLoadingSession && key !== "race" ? "…" : count || "none"}</span>}
                </button>
              ))}
            </div>
            {sessionView === "race" ? <p className="text-[14px] text-white/[0.72]">Race results are in the race report, the field (table) and the head-to-head for {raceScopeLabel ? `${season} / ${raceScopeLabel}` : season}.</p> : sessionView === "telemetry" ? <TelemetryPanel context={viewContext} /> : isLoadingSession ? <ViewSkeleton label="Loading session data" rows={5} /> : sessionView === "practice" ? (
              <PracticeBestPanel summary={practiceBest} sources={sessionEndpoints.map((endpoint) => `GET ${endpoint}`)} />
            ) : sessionView === "qualifying" ? qualifying?.length ? (
              <div className="overflow-x-auto" tabIndex={0} aria-label="Qualifying classification"><table className="w-full min-w-[680px] border-collapse text-left"><thead><tr className={tableHead}><th scope="col" className="py-2 pr-4">Pos.</th><th scope="col" className="px-3 py-2">Driver</th><th scope="col" className="px-3 py-2">Team</th><th scope="col" className="px-3 py-2">Q1</th><th scope="col" className="px-3 py-2">Q2</th><th scope="col" className="px-3 py-2">Q3</th></tr></thead><tbody>{qualifying.slice(0, 22).map((row) => <tr key={`${row.position}-${row.first_name}-${row.last_name}`} className="border-b border-white/[0.04]"><td className="py-2 pr-4 font-mono text-[13px] tabular-nums text-white/[0.66]">{row.position}</td><td className="px-3 py-2 text-[14px] text-white/[0.86]">{row.first_name} {row.last_name}</td><td className="px-3 py-2 text-[13px] text-white/[0.70]"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: teamColor(row.team) }} />{row.team}</span></td><td className={tableCell}>{row.q1 ?? "—"}</td><td className={tableCell}>{row.q2 ?? "—"}</td><td className={tableCell}>{row.q3 ?? "—"}</td></tr>)}</tbody></table><p className="mt-2 text-[12px] text-white/[0.62]">— in Q2 / Q3: eliminated in an earlier part, no time set.</p></div>
            ) : qualifyingWithheld ? <NotPublished title="Qualifying result under verification" detail="The official qualifying classification for this round is withheld until its driver identities pass the integrity check. The Lab does not substitute a prediction for a measured result." source={round == null ? null : `GET /v1/f1/races/${season}/${round}/qualifying`} tone="amber" /> : <NotPublished detail="The API returned no qualifying result for this round. The Lab does not substitute a prediction for a measured result." source={round == null ? null : `GET /v1/f1/races/${season}/${round}/qualifying`} /> : qualifyingPrediction?.length ? (
              <div className="overflow-x-auto" tabIndex={0} aria-label="Qualifying forecast"><table className="w-full min-w-[620px] border-collapse text-left"><thead><tr className={tableHead}><th scope="col" className="py-2 pr-4">Rank</th><th scope="col" className="px-3 py-2">Driver</th><th scope="col" className="px-3 py-2">Expected pos.</th><th scope="col" className="px-3 py-2">Pole</th><th scope="col" className="px-3 py-2">Q3</th></tr></thead><tbody>{qualifyingPrediction.slice(0, 22).map((row) => <tr key={row.driver_name} className="border-b border-white/[0.04]"><td className="py-2 pr-4 font-mono text-[13px] tabular-nums text-white/[0.66]">{row.position}</td><td className="px-3 py-2 text-[14px] text-white/[0.86]">{row.driver_name}</td><td className={tableCell}>{row.expected_position.toFixed(1)}</td><td className={tableCell}>{(row.p_pole * 100).toFixed(1)}%</td><td className={tableCell}>{(row.p_q3 * 100).toFixed(0)}%</td></tr>)}</tbody></table></div>
            ) : <NotPublished title="No qualifying forecast published" detail="The API returned no qualifying forecast for this round. No probability is fabricated." source={round == null ? null : `GET /v1/f1/predictions/qualifying/${season}/${round}`} />}
          </ViewCard>
        );
      case "seasons":
        return (
          <ViewCard
            id="lab-seasons"
            title="One driver across seasons"
            scope={`${comparisonRows.length} seasons · final or current standings · seasons are never blended`}
            endpoints={comparisonRows.map(({ year }) => `/v1/f1/standings/drivers/${year}`)}
            source={{ source: "tdd" }}
            exportRows={comparisonExportRows}
            exportName={exportBasename("season-comparison", season, null)}
            actions={<label className="block w-[150px] sm:w-[220px]"><span className="sr-only">Driver</span><select aria-label="Driver across seasons" value={comparisonDriver} onChange={(event) => { setComparisonDriver(event.target.value); setHasExplicitComparisonDriver(true); }} className="control-select"><option value="">Choose a driver</option>{comparisonOptions.map((driver) => <option key={driver.id} value={driver.id}>{driver.tla} · {driver.name}</option>)}</select></label>}
          >
            <div className="overflow-x-auto" tabIndex={0} aria-label="Season comparison table"><table className="w-full min-w-[620px] border-collapse text-left"><thead><tr className={tableHead}><th scope="col" className="py-2 pr-4">Season</th><th scope="col" className="px-3 py-2">Driver</th><th scope="col" className="px-3 py-2">Position</th><th scope="col" className="px-3 py-2">Points</th><th scope="col" className="px-3 py-2">Wins</th><th scope="col" className="px-3 py-2">Freshness</th></tr></thead><tbody>{comparisonRows.map(({ year, standing, timestamp, unavailable }) => { const selected = comparisonOptions.find((driver) => String(driver.id) === comparisonDriver); return <tr key={year} className="border-b border-white/[0.04]"><td className="py-2 pr-4 font-mono text-[13px] text-light">{year}</td><td className="px-3 py-2 text-[14px] text-white/[0.86]">{standing ? <><span className="font-mono text-[12px]" style={{ color: readableTeamColor(standing.team_name) }}>{driverTla(standing.first_name, standing.last_name)}</span><span className="ml-2">{standing.first_name} {standing.last_name}</span></> : selected ? <><span className="font-mono text-[12px]">{selected.tla}</span><span className="ml-2">{selected.name}</span></> : "No driver chosen"}</td><td className={tableCell}>{unavailable ? "Unavailable" : standing?.position ?? "Not in season"}</td><td className={tableCell}>{standing?.points ?? (unavailable ? "Unavailable" : "Not classified")}</td><td className={tableCell}>{standing?.wins ?? (unavailable ? "Unavailable" : "Not classified")}</td><td className="px-3 py-2 text-[13px] text-white/[0.70]">{unavailable ? "Unavailable" : timestamp ? formatSourceTimestamp(timestamp) : "Not published by the API"}</td></tr>; })}</tbody></table></div>
          </ViewCard>
        );
      case "ask":
        return (
          <section id="lab-ask" aria-labelledby="lab-ask-title" className="min-w-0 scroll-mt-32">
            <h1 id="lab-ask-title" className="font-serif text-[26px] leading-8 tracking-[-0.02em] text-light md:text-[30px] md:leading-9">Ask the data</h1>
            <p className="mt-1 max-w-2xl text-[14px] leading-5 text-white/[0.70]">{askMode === "grounded" ? `Answers come from the grounded endpoint and the race on screen (${raceScopeLabel ? `${season} · ${raceScopeLabel}` : season}), with their sources.` : "Bring your own AI model: it may answer only from The Data Driver API tools it calls, and must cite them."}</p>
            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.018] p-4 md:p-5">
                <div role="group" aria-label="Answer mode" className="inline-flex rounded-lg border border-white/[0.10] p-1">
                  {([["grounded", "Grounded (default)"], ["ai", "AI — your own key"]] as const).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={askMode === value} onClick={() => setAskMode(value)} className={`min-h-11 rounded-md px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 lg:min-h-9 ${askMode === value ? "bg-white/[0.10] text-light" : "text-white/[0.72] hover:text-light"}`}>{label}</button>
                  ))}
                </div>
                {askMode === "grounded" ? <><form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void askQuestion(); }}><label htmlFor="lab-question" className="sr-only">Question about the selected F1 data</label><input id="lab-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. Who gained the most positions?" className="control-input flex-1" /><button type="submit" disabled={!question.trim() || isAsking} className="min-h-11 rounded-lg bg-light px-4 text-[14px] font-medium text-dark disabled:cursor-not-allowed disabled:opacity-50">{isAsking ? "Querying…" : "Ask"}</button></form>{answer && <div className="mt-5 border-t border-white/[0.08] pt-5" aria-live="polite"><p className="text-body leading-relaxed text-white/[0.86]">{answer.answer}</p>{answer.sources.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{answer.sources.map((source, index) => <SourceCitation key={`${source.href ?? "text"}:${source.title}:${index}`} source={source} />)}</div>}</div>}</> : <AskAiPanel season={LIVE_SEASON} />}
              </div>
              {askMode === "grounded" ? <div className="rounded-xl border border-white/[0.08] bg-white/[0.018] p-4"><h2 className="text-[14px] font-medium text-white/[0.86]">Try a question</h2><div className="mt-2 space-y-1">{starterQuestions.map((starter) => <button key={starter} type="button" onClick={() => handleStarterQuestion(starter)} aria-label={`Ask: ${starter}`} data-question={starter} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-[14px] text-white/[0.78] hover:bg-white/[0.04] hover:text-light"><span>{starter}</span><span aria-hidden="true" className="text-white/[0.66]">→</span></button>)}</div></div> : (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.018] p-4 text-[14px] leading-relaxed text-white/[0.72]">
                  <h2 className="mb-3 text-[14px] font-medium text-white/[0.86]">How AI mode works</h2>
                  <ul className="space-y-3">
                    <li>Your key stays in this browser. Requests go straight from this page to the provider you choose, never through The Data Driver.</li>
                    <li>The key is kept for this tab only unless you tick &ldquo;Remember on this device&rdquo;. &ldquo;Forget key&rdquo; stops a running question and removes it.</li>
                    <li>The model can only read the public API through read-only tools. Each answer lists the tool calls and the sources it read; OpenF1 data is non-official enrichment (CC BY-NC-SA 4.0).</li>
                    <li>Models can still make mistakes: check the sources. The grounded mode stays the default.</li>
                  </ul>
                  <a href={AI_GUIDE_URL} className="mt-4 inline-block text-[14px] text-light underline-offset-4 hover:underline">Providers, local models and CORS →</a>
                </div>
              )}
            </div>
            <footer className="mt-3 text-[12px] leading-5 text-white/[0.62]">Source · The Data Driver API (grounded endpoint and read-only tools) · OpenF1 rows are non-official enrichment, CC BY-NC-SA 4.0.</footer>
          </section>
        );
    }
  }

  // A race that has not been run yet has no results: that is not an outage.
  const raceNotRun = selectedRace != null && selectedRace.status !== "completed";
  const statusMessages = [...new Set([seasonError, raceNotRun ? null : raceError, raceNotRun ? null : sessionError, view === "seasons" ? historicalSeasonError : null].filter((message): message is string => Boolean(message)))];
  const apiContext = { open: apiOpen, setOpen: setApiOpen };

  return (
    <LabResourceProvider seed={initialSeed} refreshVersion={liveResourceVersion} raceScope={liveActive && round != null ? `/v1/f1/races/${season}/${round}/` : null}>
    <ApiPanelContext.Provider value={apiContext}>
    <ChartCursorProvider>
    <div className="min-h-[calc(100vh-3.5rem)] bg-dark" data-lab-hydrated={hydrated ? "true" : undefined}>
      <div className="border-b border-white/[0.06] bg-dark/95 backdrop-blur lg:sticky lg:top-14 lg:z-30" data-lab-bar>
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-2.5 lg:flex-nowrap lg:gap-2 lg:px-4">
          {SITE_URL ? (
            <p className="hidden font-serif text-[20px] leading-7 text-light sm:block lg:hidden 2xl:block">Data Lab</p>
          ) : (
            <Link href="/" className="hidden font-serif text-[20px] leading-7 text-light sm:block lg:hidden 2xl:block">Data Lab</Link>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
            <div className="min-w-0 flex-1 lg:flex-none">
              <RacePicker
                season={season}
                seasons={AVAILABLE_SEASONS}
                liveSeason={LIVE_SEASON}
                races={calendar.map((race) => ({ round: race.round, label: `${officialRoundLabel(race) ? `${officialRoundLabel(race)} · ` : ""}${raceLabel(race.name)}`, officialName: race.name, date: formatDate(race.date), status: race.status }))}
                round={round}
                current={raceScopeLabel}
                currentOfficialName={selectedRace?.name}
                loading={isLoadingSeason}
                onSeason={selectSeason}
                onRace={selectRace}
              />
            </div>
            <button type="button" onClick={() => setPaletteOpen(true)} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" aria-label="Search the Lab" className={`${barButton} min-w-10 justify-center px-2 lg:hidden`}>
              <span aria-hidden="true">⌕</span>
            </button>
          </div>
          <div className="w-full min-w-0 lg:w-auto">
            <DriverChips
              selected={selectedDriverRefs}
              available={buildRows(standings, [], null).map((row) => ({ id: row.id, code: row.code, name: row.name, team: row.team }))}
              max={4}
              onToggle={toggleDriver}
            />
          </div>
          <span className="hidden flex-1 lg:block" />
          <div className="w-full min-w-0 lg:w-auto lg:shrink-0">{sessionStatus}</div>
          <div className="hidden items-center gap-1.5 lg:flex">
            <button type="button" onClick={() => setPaletteOpen(true)} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" aria-label="Search the Lab (⌘K)" className={barButton}>
              <kbd className="font-mono text-[12px]">⌘K</kbd>
            </button>
            <button type="button" aria-pressed={apiOpen} onClick={() => setApiOpen((open) => !open)} className={`${barButton} font-mono text-[12px] ${apiOpen ? "bg-white/[0.10] text-light" : ""}`}>
              {"</> API"}
            </button>
            <button type="button" onClick={() => void shareView()} className={`inline-flex min-h-10 items-center rounded-lg bg-light px-3.5 text-[13px] font-medium text-dark hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70`}>
              {shareState === "copied" ? "Link copied" : shareState === "failed" ? "Copy failed" : "Share view"}
            </button>
            {!SITE_URL && <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={`${barButton} hidden 2xl:inline-flex`}>Source ↗</a>}
          </div>
          <span className="sr-only" aria-live="polite">{shareState === "copied" ? "Link to this view copied" : shareState === "failed" ? "Copy failed" : ""}</span>
        </div>
      </div>

      <div ref={workspaceRef} className="mx-auto max-w-[1600px] scroll-mt-28 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_300px]" data-workspace>
        <div className="border-b border-white/[0.06] lg:sticky lg:top-[7.5rem] lg:max-h-[calc(100vh-7.5rem)] lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-2.5 lg:pb-6">
          <ViewNav view={view} hrefFor={labQuery} onSelect={selectView} />
        </div>
        <div className="min-w-0 px-4 pb-8 pt-4 lg:px-7 lg:pb-16 lg:pt-6" data-view={view}>
          {statusMessages.length > 0 && (
            <section aria-label="System status" role="status" aria-live="polite" className="mb-4 flex flex-wrap items-baseline gap-x-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[13px]">
              <span className="font-medium text-amber-400">Live data status:</span>
              {statusMessages.map((message) => <span key={message} className="text-white/[0.78]">{message}</span>)}
            </section>
          )}
          {renderView()}
        </div>
        <div className="border-t border-white/[0.06] px-4 pb-32 pt-6 lg:col-start-2 lg:px-7 lg:pb-12 xl:col-start-3 xl:row-start-1 xl:border-l xl:border-t-0 xl:px-5 xl:pb-12">
          <LabInspector view={view} context={viewContext} onAsk={() => selectView("ask")} shortcuts={shortcuts} />
        </div>
      </div>

      <MobileActionBar
        onAsk={() => selectView("ask")}
        menu={[
          { label: shareState === "copied" ? "Link copied" : "Share view (copy link)", run: () => void shareView() },
          { label: apiOpen ? "Hide API requests and export" : "Show API requests and export", run: () => setApiOpen((open) => !open) },
          { label: "Search the Lab", run: () => setPaletteOpen(true) },
        ]}
      />
      {paletteOpen && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commands} />}
      <noscript>
        <style>{"[data-view-placeholder] [data-skeleton]{display:none}"}</style>
      </noscript>
    </div>
    </ChartCursorProvider>
    </ApiPanelContext.Provider>
    </LabResourceProvider>
  );
}

function PracticeBestPanel({ summary, sources }: { summary: PracticeBestSummary | null; sources: string[] }) {
  const rows = summary?.rows ?? [];
  const failed = summary?.failed ?? [];
  const unpublished = summary?.unpublished ?? [];
  // The API gives one reason per session; when they differ only by the
  // session name, the first is quoted verbatim and the others are named.
  const reasonGroups = new Map<string, { reason: string; sessions: string[] }>();
  for (const item of unpublished) {
    if (!item.reason) continue;
    const key = item.reason.replace(/\bFP[1-3]\b/g, "FP");
    const group = reasonGroups.get(key);
    if (group) group.sessions.push(item.session);
    else reasonGroups.set(key, { reason: item.reason, sessions: [item.session] });
  }
  const reasons = [...reasonGroups.values()].map(({ reason, sessions }) => (sessions.length > 1 ? `${reason} Same for ${sessions.slice(1).join(", ")}.` : reason));
  const failedNote = failed.length
    ? `${failed.map((item) => `${item.session}${item.status ? ` (HTTP ${item.status})` : ""}`).join(", ")} could not be read`
    : null;
  if (rows.length === 0) {
    const allFailed = failed.length > 0 && unpublished.length === 0;
    return (
      <NotPublished
        title={allFailed ? "Practice best laps unavailable" : undefined}
        tone={allFailed ? "amber" : "neutral"}
        detail={allFailed
          ? `The practice classification endpoints did not answer: ${failedNote}. No session result is inferred.`
          : `The API publishes no practice best laps for this race weekend.${reasons.length ? ` API reason: ${reasons.join(" ")}` : ""}${failedNote ? ` ${failedNote}.` : ""} No session result is inferred.`}
        source={sources.map((source) => source.replace(/^GET /, "")).join(" · ") || null}
      />
    );
  }
  return (
    <div>
      {(failedNote || unpublished.length > 0) && (
        <p className={`mb-3 text-[13px] ${failedNote ? "text-amber-400" : "text-white/[0.72]"}`} data-practice-coverage>
          {failedNote ? `Partial: ${failedNote}. ` : ""}
          {unpublished.length > 0 ? `${unpublished.map((item) => item.session).join(", ")} not published` : ""}
          {reasons.length ? <span> · API reason: {reasons.join(" ")}</span> : null}
        </p>
      )}
      <div className="overflow-x-auto" tabIndex={0} aria-label="Practice best laps">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className={tableHead}>
              <th scope="col" className="py-2 pr-4">Session</th>
              <th scope="col" className="px-3 py-2">Pos.</th>
              <th scope="col" className="px-3 py-2">Driver</th>
              <th scope="col" className="px-3 py-2">Best lap</th>
              <th scope="col" className="px-3 py-2">Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.session}-${row.driverCode || row.driver}`} className="border-b border-white/[0.04]">
                <td className="py-2 pr-4 font-mono text-[13px] text-light">{row.session}</td>
                <td className={tableCell}>{row.rank ?? "Not published"}</td>
                <td className="px-3 py-2 text-[14px] text-white/[0.86]">{row.driver}</td>
                <td className={tableCell}>{formatLapMs(row.bestMs)}</td>
                <td className={tableCell}>{row.gapMs === 0 ? "Fastest" : `+${(row.gapMs / 1000).toFixed(3)}s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-white/[0.62]">Each driver&apos;s fastest timed lap per session, computed by the API over every lap (out-laps excluded). Non-official OpenF1 enrichment.</p>
    </div>
  );
}
