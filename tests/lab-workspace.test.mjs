import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  defaultLabView,
  formatCountdown,
  formatRaceDay,
  isLabViewId,
  LAB_VIEW_GROUPS,
  LAB_VIEWS,
  nextRaceAfter,
  parseLabView,
  raceStartMs,
} from "../src/lib/lab-workspace.mjs";
import {
  biggestGainFigure,
  comparisonInsights,
  constructorInsights,
  fastestLapFigure,
  formatLapTime,
  neutralisationFigure,
  raceInsights,
  raceLaps,
  standingsInsights,
  winnerFigure,
} from "../src/lib/lab-insights.mjs";
import { buildStarterAnswer, STARTER_QUESTIONS } from "../src/lib/lab-grounded-queries.mjs";
import { spreadLabels } from "../src/components/lab/charts/label-layout.mjs";

const result = (first, last, position, grid, extra = {}) => ({ first_name: first, last_name: last, driver_code: last.slice(0, 3).toUpperCase(), team_name: "Fixture Team", position, grid, laps: 57, ...extra });

test("the workspace has twelve views in four groups, each with a unique anchor", () => {
  assert.equal(LAB_VIEWS.length, 12);
  assert.deepEqual(LAB_VIEW_GROUPS, ["Season", "Race", "Compare", "Ask"]);
  assert.equal(new Set(LAB_VIEWS.map((view) => view.anchor)).size, 12);
  assert.ok(LAB_VIEWS.every((view) => LAB_VIEW_GROUPS.includes(view.group)));
  assert.deepEqual(LAB_VIEWS.filter((view) => view.group === "Race").map((view) => view.label), ["Race report", "Race pace", "Fastest laps", "Strategy", "Race timeline", "Sessions"]);
});

test("the view in the URL is honoured; anything else falls back to the default", () => {
  assert.equal(parseLabView("pace", true), "pace");
  assert.equal(parseLabView("strategy", false), "strategy");
  assert.equal(parseLabView("explorer", true), "report");
  assert.equal(parseLabView(null, true), "report");
  assert.equal(parseLabView(undefined, false), "championship");
  assert.equal(defaultLabView(true), "report");
  assert.equal(isLabViewId("__proto__"), false);
  assert.equal(isLabViewId("ask"), true);
});

test("countdown keeps whole units and never rounds up", () => {
  const hour = 3_600_000;
  assert.equal(formatCountdown(4 * 24 * hour + 2 * hour), "4d 2h");
  assert.equal(formatCountdown(4 * 24 * hour + 2 * hour - 1), "4d 1h");
  assert.equal(formatCountdown(3 * hour + 12 * 60_000), "3h 12m");
  assert.equal(formatCountdown(42 * 60_000 + 59_000), "42 min");
  assert.equal(formatCountdown(30_000), "under a minute");
  assert.equal(formatCountdown(0), "now");
  assert.equal(formatCountdown(Number.NaN), "now");
});

test("race start uses the published time in UTC, or race-day midnight when there is none", () => {
  assert.equal(raceStartMs({ date: "2026-08-30", time: "14:00:00Z" }), Date.UTC(2026, 7, 30, 14));
  assert.equal(raceStartMs({ date: "2026-08-30", time: "14:00" }), Date.UTC(2026, 7, 30, 14));
  assert.equal(raceStartMs({ date: "2026-08-30", time: null }), Date.UTC(2026, 7, 30));
  assert.equal(raceStartMs({ date: "30/08/2026", time: null }), null);
  assert.equal(formatRaceDay({ date: "2026-10-11" }), "Sun 11 Oct");
});

test("the next race is the first one not run yet, in date order, never a completed or past one", () => {
  const races = [
    { round: 25, name: "Late key, early date", date: "2026-10-04", time: "13:00:00Z", status: "completed" },
    { round: 18, name: "Singapore", date: "2026-10-11", time: "12:00:00Z", status: "upcoming" },
    { round: 17, name: "Past but not marked completed", date: "2026-09-26", time: "11:00:00Z", status: "upcoming" },
    { round: 19, name: "Austin", date: "2026-10-25", time: "19:00:00Z", status: "upcoming" },
  ];
  assert.equal(nextRaceAfter(races, Date.UTC(2026, 9, 7))?.round, 18);
  assert.equal(nextRaceAfter(races, Date.UTC(2026, 9, 12))?.round, 19);
  assert.equal(nextRaceAfter(races, Date.UTC(2026, 11, 31)), null);
});

test("winner and biggest gain follow the official classification; the gain uses the chat's rule", () => {
  const results = [
    result("Lando", "Norris", 1, 2, { team_name: "McLaren" }),
    result("Oscar", "Piastri", 2, 1),
    result("Lewis", "Hamilton", 3, 9),
    result("Pit", "Lane", 4, 0),
    result("Not", "Classified", null, 3),
  ];
  assert.deepEqual(winnerFigure(results), { state: "ok", value: "Lando Norris", detail: "McLaren · from P2 on the grid", code: "NOR" });
  assert.deepEqual(biggestGainFigure(results), { state: "ok", value: "+6", detail: "Lewis Hamilton, P9 to P3" });
  const chat = buildStarterAnswer(STARTER_QUESTIONS.POSITION_GAIN, { season: 2026, round: 13, roundLabel: "R11", results });
  assert.match(chat.answer, /^Lewis Hamilton gained the most positions in 2026 R11: 6 places, from P9 to P3\.$/);

  const tied = [result("A", "One", 1, 3), result("B", "Two", 2, 4), result("C", "Three", 3, 1)];
  assert.deepEqual(biggestGainFigure(tied), { state: "ok", value: "+2", detail: "Tied: A One and B Two" });
  assert.deepEqual(biggestGainFigure([result("A", "One", 1, 1), result("B", "Two", 2, 2)]), { state: "ok", value: "0", detail: "No driver gained a place from the grid" });
  assert.equal(biggestGainFigure([]).state, "unavailable");
  assert.equal(winnerFigure([result("A", "One", 2, 1)]).state, "unavailable");
  assert.equal(raceLaps(results), 57);
  assert.equal(raceLaps([]), null);
});

test("fastest lap is the minimum published time; missing times are never guessed", () => {
  const laps = [
    { driver_code: "PIA", last_name: "Piastri", time_ms: 90_710, time_formatted: "1:30.710", lap: 51 },
    { driver_code: "NOR", last_name: "Norris", time_ms: 90_500, time_formatted: null, lap: 50 },
    { driver_code: "VER", last_name: "Verstappen", time_ms: null, lap: 12 },
  ];
  assert.deepEqual(fastestLapFigure(laps), { state: "ok", value: "1:30.500", detail: "Norris · lap 50", code: "NOR" });
  assert.deepEqual(fastestLapFigure([{ last_name: "Norris", time_ms: 90_500 }]), { state: "ok", value: "1:30.500", detail: "Norris · lap not published", code: null });
  assert.equal(fastestLapFigure([{ last_name: "Norris", time_ms: null }]).state, "unavailable");
  assert.equal(formatLapTime(58_123), "58.123s");
  assert.equal(formatLapTime(null), null);
});

test("neutralisations count safety cars and VSCs separately", () => {
  assert.deepEqual(neutralisationFigure([{ type: "SC" }, { type: "VSC" }, { type: "SC" }]), { state: "ok", value: "3", detail: "2 safety cars · 1 VSC" });
  assert.deepEqual(neutralisationFigure([]), { state: "ok", value: "0", detail: "No safety car or VSC published" });
});

test("what stands out: fixed sentences from the rows, nothing when they cannot be computed", () => {
  const standings = [
    { position: 1, first_name: "Lando", last_name: "Norris", points: 219, wins: 4 },
    { position: 2, first_name: "Oscar", last_name: "Piastri", points: 198, wins: 3 },
    { position: 3, first_name: "Max", last_name: "Verstappen", points: 172, wins: 2 },
    { position: 4, first_name: "George", last_name: "Russell", points: 172, wins: 1 },
  ];
  assert.deepEqual(standingsInsights(standings), [
    "Lando Norris leads Oscar Piastri by 21 points with 4 wins.",
    "Max Verstappen and George Russell are level on 172 points.",
  ]);
  assert.deepEqual(standingsInsights([{ position: 1, first_name: "A", last_name: "One", points: 10, wins: null }, { position: 2, first_name: "B", last_name: "Two", points: 10 }]), ["A One and B Two are level on 10 points at the top."]);
  assert.deepEqual(standingsInsights(standings.slice(0, 1)), []);
  assert.deepEqual(standingsInsights([{ first_name: "A", last_name: "One", points: null }, { first_name: "B", last_name: "Two", points: null }]), []);

  assert.deepEqual(raceInsights([result("Lando", "Norris", 1, 2), result("Lewis", "Hamilton", 2, 7)]), [
    "Lando Norris won from P2 on the grid.",
    "Lewis Hamilton gained the most places: P7 to P2 (+5).",
  ]);
  assert.deepEqual(raceInsights([]), []);
  assert.deepEqual(constructorInsights([{ position: 2, team_name: "Ferrari", points: 193 }, { position: 1, team_name: "McLaren", points: 417 }]), ["McLaren leads Ferrari by 224 points."]);
  assert.deepEqual(comparisonInsights([{ first_name: "Oscar", last_name: "Piastri", points: 198 }, { first_name: "Lando", last_name: "Norris", points: 219 }]), ["Lando Norris is 21 points ahead of Oscar Piastri."]);
  assert.deepEqual(comparisonInsights([{ first_name: "A", last_name: "One", points: 1 }]), []);
});

test("end-of-line labels never overlap and stay inside the plot", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  for (let run = 0; run < 500; run += 1) {
    const count = 1 + Math.floor(random() * 10);
    const min = 20;
    const max = 20 + 60 + Math.floor(random() * 300);
    const labels = Array.from({ length: count }, (_, id) => ({ id, y: min - 40 + random() * (max - min + 80) }));
    const placed = spreadLabels(labels, 15, min, max);
    assert.equal(placed.length, count);
    assert.ok(placed.every((label) => label.y >= min - 1e-9 && label.y <= max + 1e-9), `inside, run ${run}`);
    const gap = Math.min(15, count > 1 ? (max - min) / (count - 1) : 15);
    for (let i = 1; i < placed.length; i += 1) assert.ok(placed[i].y - placed[i - 1].y >= gap - 1e-9, `no overlap, run ${run}`);
  }
  // Five lines ending on the same value (a tie in points) fan out.
  const tie = spreadLabels([0, 1, 2, 3, 4].map((id) => ({ id, y: 100 })), 15, 20, 300);
  assert.deepEqual(tie.map((label) => label.y), [100, 115, 130, 145, 160]);
});

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|mjs)$/.test(name) ? [path] : [];
  });
}

test("Lab interface text is at least 12 px and drops mono uppercase micro-labels", () => {
  const root = new URL("../", import.meta.url).pathname;
  // Site layout (src/app/lab/) or open-source layout (src/app/LabPageClient.tsx).
  const page = existsSync(join(root, "src/app/lab")) ? sourceFiles(join(root, "src/app/lab")) : [join(root, "src/app/LabPageClient.tsx")];
  const files = [...sourceFiles(join(root, "src/components/lab")), ...page];
  const offenders = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [
      ...[...source.matchAll(/text-\[(?:[0-9]|1[01])px\]/g)].map((match) => `${file}: ${match[0]}`),
      ...[...source.matchAll(/\buppercase\b/g)].map(() => `${file}: uppercase`),
      ...[...source.matchAll(/fontSize="(?:[0-9]|1[01])"/g)].map((match) => `${file}: ${match[0]}`),
    ];
  });
  assert.deepEqual(offenders, []);
});
