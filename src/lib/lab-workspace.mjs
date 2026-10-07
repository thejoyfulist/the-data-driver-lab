/**
 * Data Lab workspace: the view registry (one view on screen at a time, kept
 * in the URL), and the small pure helpers behind the top bar. No React here,
 * so node --test can exercise it directly.
 */

export const LAB_VIEW_GROUPS = ["Season", "Race", "Compare", "Ask"];

export const LAB_VIEWS = [
  { id: "field", label: "Field", group: "Season", anchor: "lab-field", keywords: "points finish grid laps win probability bars table explorer rows" },
  { id: "championship", label: "Championship", group: "Season", anchor: "lab-championship", keywords: "progression standings evolution cumulative points" },
  { id: "constructors", label: "Constructors", group: "Season", anchor: "lab-constructors", keywords: "teams standings" },
  { id: "report", label: "Race report", group: "Race", anchor: "lab-report", keywords: "summary winner key figures overview" },
  { id: "pace", label: "Race pace", group: "Race", anchor: "lab-pace", keywords: "lap times laps pace" },
  { id: "fastest", label: "Fastest laps", group: "Race", anchor: "lab-fastest", keywords: "fastest lap gap" },
  { id: "strategy", label: "Strategy", group: "Race", anchor: "lab-strategy", keywords: "pit stops stints tyres" },
  { id: "timeline", label: "Race timeline", group: "Race", anchor: "lab-timeline", keywords: "safety car vsc incidents weather retirements" },
  { id: "sessions", label: "Sessions", group: "Race", anchor: "lab-sessions", keywords: "practice qualifying telemetry forecast" },
  { id: "h2h", label: "Head-to-head", group: "Compare", anchor: "lab-head-to-head", keywords: "compare drivers teammates h2h" },
  { id: "seasons", label: "Across seasons", group: "Compare", anchor: "lab-seasons", keywords: "history archive career" },
  { id: "ask", label: "Ask the data", group: "Ask", anchor: "lab-ask", keywords: "question chat ai" },
];

const VIEW_IDS = new Set(LAB_VIEWS.map((view) => view.id));

export function isLabViewId(value) {
  return typeof value === "string" && VIEW_IDS.has(value);
}

/** The race report when a race is chosen, the championship otherwise. */
export function defaultLabView(hasRace) {
  return hasRace ? "report" : "championship";
}

export function labViewDef(id) {
  return LAB_VIEWS.find((view) => view.id === id) ?? LAB_VIEWS[0];
}

/** `?view=` value from a URL, falling back to the default view. */
export function parseLabView(value, hasRace) {
  return isLabViewId(value) ? value : defaultLabView(hasRace);
}

// ── Session status ──────────────────────────────────────────────────────

const MINUTE = 60_000;

/**
 * "1d 18h", "3h 12m", "42 min", "under a minute". Whole units only, never
 * rounded up, so the countdown never claims more time than is left.
 */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Start of the Grand Prix in UTC, from the calendar's date and (when
 * published) start time. A race without a published time counts from
 * 00:00 UTC on race day: earlier, never later, than the real start.
 */
export function raceStartMs(race) {
  if (!race || !/^\d{4}-\d{2}-\d{2}$/.test(race.date)) return null;
  const time = typeof race.time === "string" && /^\d{2}:\d{2}(:\d{2})?Z?$/.test(race.time) ? race.time : null;
  const value = Date.parse(`${race.date}T${time ? time.replace(/Z?$/, "Z") : "00:00:00Z"}`);
  return Number.isFinite(value) ? value : null;
}

/** First race that has not started yet, in calendar (date) order. */
export function nextRaceAfter(races, now) {
  return races
    .filter((race) => race.status !== "completed" && race.status !== "cancelled")
    .map((race) => ({ race, start: raceStartMs(race) }))
    .filter((entry) => entry.start != null && entry.start > now)
    .sort((a, b) => a.start - b.start)[0]?.race ?? null;
}

/** "Sun 11 Oct" in UTC (the Lab's weekend window is defined in UTC). */
export function formatRaceDay(race) {
  if (!race || !/^\d{4}-\d{2}-\d{2}$/.test(race.date)) return null;
  const date = new Date(`${race.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}
