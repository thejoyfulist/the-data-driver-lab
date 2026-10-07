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
  formatShortLapTime,
  neutralisationFigure,
  raceInsights,
  raceLaps,
  standingsInsights,
  winnerFigure,
} from "../src/lib/lab-insights.mjs";
import { buildStarterAnswer, STARTER_QUESTIONS } from "../src/lib/lab-grounded-queries.mjs";
import { spreadLabels } from "../src/components/lab/charts/label-layout.mjs";
import {
  biggestClimbFigure,
  buildPositionSeries,
  buildTyreStrategy,
  compoundSequence,
  describeStint,
  normaliseCompound,
  orderAtLap,
  TYRE_COMPOUNDS,
} from "../src/lib/lab-strategy.mjs";

const result = (first, last, position, grid, extra = {}) => ({ first_name: first, last_name: last, driver_code: last.slice(0, 3).toUpperCase(), team_name: "Fixture Team", position, grid, laps: 57, ...extra });

test("the workspace has thirteen views in four groups, each with a unique anchor", () => {
  assert.equal(LAB_VIEWS.length, 13);
  assert.deepEqual(LAB_VIEW_GROUPS, ["Season", "Race", "Compare", "Ask"]);
  assert.equal(new Set(LAB_VIEWS.map((view) => view.anchor)).size, 13);
  assert.ok(LAB_VIEWS.every((view) => LAB_VIEW_GROUPS.includes(view.group)));
  assert.deepEqual(LAB_VIEWS.filter((view) => view.group === "Race").map((view) => view.label), ["Race report", "Race pace", "Fastest laps", "Strategy", "Positions", "Race timeline", "Sessions"]);
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
  // The published text is never trusted: an inconsistent time_formatted is ignored.
  assert.equal(fastestLapFigure([{ last_name: "Russell", time_ms: 91_130, time_formatted: "1:30.1130", lap: 53 }]).value, "1:31.130");
});

test("lap times are formatted from milliseconds, carrying into seconds and minutes", () => {
  assert.equal(formatLapTime(90_500), "1:30.500");
  assert.equal(formatLapTime(91_130), "1:31.130"); // crosses a second
  assert.equal(formatLapTime(91_000), "1:31.000");
  assert.equal(formatLapTime(59_999), "59.999s");
  assert.equal(formatLapTime(60_000), "1:00.000"); // crosses a minute
  assert.equal(formatLapTime(119_999.6), "2:00.000"); // rounding carries into the minute
  assert.equal(formatLapTime(65_004), "1:05.004");
  assert.equal(formatLapTime(3_723_045), "62:03.045");
  assert.equal(formatLapTime(999), "0.999s");
  for (const missing of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "91130"]) {
    assert.equal(formatLapTime(missing), null, String(missing));
  }
  assert.equal(formatShortLapTime(91_130), "1:31.1");
  assert.equal(formatShortLapTime(119_960), "2:00.0"); // never "1:60.0"
  assert.equal(formatShortLapTime(59_960), "1:00.0");
  assert.equal(formatShortLapTime(58_123), "58.1s");
  assert.equal(formatShortLapTime(61_049), "1:01.0");
  assert.equal(formatShortLapTime(null), null);
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

// ── Tyre strategy and lap-by-lap positions (lot H) ──────────────────────

const contractDriver = (id, code, first, last, extra = {}) => ({ driver_id: id, driver_code: code, first_name: first, last_name: last, team_name: "Fixture Team", ...extra });
const classified = [
  { driver_id: 1, driver_code: "AAA", first_name: "Ann", last_name: "Alpha", position: 1, grid: 3, laps: 50 },
  { driver_id: 2, driver_code: "BBB", first_name: "Bea", last_name: "Bravo", position: 2, grid: 1, laps: 50 },
  { driver_id: 3, driver_code: "CCC", first_name: "Cal", last_name: "Charlie", position: 3, grid: 6, laps: 50 },
  { driver_id: 4, driver_code: "DDD", first_name: "Dee", last_name: "Delta", position: null, grid: 2, laps: 12, status: "DNF" },
];

test("compounds: the five Pirelli compounds each have a letter, a pattern and readable text", () => {
  assert.deepEqual(["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].map((id) => TYRE_COMPOUNDS[id].letter), ["S", "M", "H", "I", "W"]);
  assert.equal(new Set(Object.values(TYRE_COMPOUNDS).map((compound) => compound.pattern)).size, Object.keys(TYRE_COMPOUNDS).length);
  assert.equal(normaliseCompound("medium"), "MEDIUM");
  assert.equal(normaliseCompound("INTER"), "INTERMEDIATE");
  assert.equal(normaliseCompound("HYPERSOFT"), "UNKNOWN");
  assert.equal(normaliseCompound(null), "UNKNOWN");
  // WCAG contrast of the letter on its compound colour.
  const channel = (hex, index) => {
    const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
  for (const compound of Object.values(TYRE_COMPOUNDS)) {
    const [light, dark] = [luminance(compound.fill), luminance(compound.text)].sort((a, b) => b - a);
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `${compound.id} letter contrast`);
  }
});

test("strategy: rows in finishing order, official stops when published, stint changes otherwise", () => {
  const stints = {
    availability: "complete",
    race_laps: 50,
    drivers: [
      contractDriver(4, "DDD", "Dee", "Delta", { stints: [{ stint_number: 1, compound: "SOFT", start_lap: 1, end_lap: 12, laps: 12, tyre_age_at_start: 0 }] }),
      contractDriver(3, "CCC", "Cal", "Charlie", { stints: [
        { stint_number: 2, compound: "HARD", start_lap: 21, end_lap: 50, laps: 30, tyre_age_at_start: 2 },
        { stint_number: 1, compound: "MEDIUM", start_lap: 1, end_lap: 20, laps: 20, tyre_age_at_start: 0 },
      ] }),
      contractDriver(1, "AAA", "Ann", "Alpha", { stints: [
        { stint_number: 1, compound: "MEDIUM", start_lap: 1, end_lap: 25, laps: 25, tyre_age_at_start: null },
        { stint_number: 2, compound: "mystery", start_lap: 26, end_lap: 50, laps: 25, tyre_age_at_start: 0 },
        { stint_number: 3, compound: "SOFT", start_lap: 40, end_lap: 39, laps: 0 },
      ] }),
      contractDriver(2, "BBB", "Bea", "Bravo", { stints: [] }),
    ],
  };
  const pitStops = [{ driver_code: "AAA", lap: 25, duration_ms: 21_900 }];
  const strategy = buildTyreStrategy(stints, classified, pitStops);
  assert.equal(strategy.availability, "complete");
  assert.equal(strategy.maxLap, 50);
  // Bravo has no stint: no row (never drawn as "no stop"); Delta (DNF) last.
  assert.deepEqual(strategy.rows.map((row) => [row.code, row.finish]), [["AAA", 1], ["CCC", 3], ["DDD", null]]);
  const [alpha, charlie, delta] = strategy.rows;
  assert.equal(compoundSequence(alpha), "M–?");
  assert.deepEqual(alpha.stops, [{ lap: 25, durationMs: 21_900, derived: false }]);
  assert.equal(alpha.stints.length, 2, "an inverted stint is dropped");
  assert.equal(alpha.stints[0].ageAtStart, null);
  assert.deepEqual(charlie.stints.map((stint) => [stint.compound, stint.start, stint.end]), [["MEDIUM", 1, 20], ["HARD", 21, 50]]);
  assert.deepEqual(charlie.stops, [{ lap: 20, durationMs: null, derived: true }]);
  assert.equal(describeStint(charlie.stints[1]), "Hard, laps 21–50 (30 laps), tyres 2 laps old at the start");
  assert.equal(describeStint(charlie.stints[0]), "Medium, laps 1–20 (20 laps), new tyres");
  assert.equal(delta.stops.length, 0);
  assert.deepEqual(buildTyreStrategy({ availability: "unavailable", reason: "Not yet", drivers: [] }).rows, []);
  assert.equal(buildTyreStrategy(null).availability, null);
});

const positionsFixture = {
  availability: "complete",
  method: "Order at each lap line",
  race_laps: 5,
  drivers: [
    // Charlie: P6 on the grid, drops to P8 on lap 2, finishes P3 → +5 in the race (+3 grid to finish).
    contractDriver(3, "CCC", "Cal", "Charlie", { grid: 6, finish: 3, positions: [{ lap: 0, position: 6 }, { lap: 1, position: 7 }, { lap: 2, position: 8 }, { lap: 3, position: 5 }, { lap: 5, position: 3 }] }),
    contractDriver(1, "AAA", "Ann", "Alpha", { grid: 3, finish: 1, positions: [{ lap: 0, position: 3 }, { lap: 1, position: 2 }, { lap: 2, position: 1 }, { lap: 2, position: 4 }, { lap: 5, position: 1 }, { lap: 6, position: 0 }] }),
    contractDriver(2, "BBB", "Bea", "Bravo", { grid: 1, finish: 2, positions: [{ lap: 0, position: 1 }, { lap: 1, position: 1 }, { lap: 5, position: 2 }] }),
    contractDriver(4, "DDD", "Dee", "Delta", { grid: 2, finish: null, positions: [{ lap: 0, position: 2 }, { lap: 1, position: 3 }] }),
  ],
};

test("positions: series in finishing order, gaps kept, duplicates and invalid rows dropped", () => {
  const series = buildPositionSeries(positionsFixture, classified);
  assert.equal(series.method, "Order at each lap line");
  assert.equal(series.maxLap, 5);
  assert.equal(series.maxPosition, 8);
  assert.deepEqual(series.drivers.map((driver) => driver.code), ["AAA", "BBB", "CCC", "DDD"]);
  assert.deepEqual(series.drivers[0].points.map((point) => point.lap), [0, 1, 2, 5]);
  assert.equal(series.drivers[0].points[2].position, 1, "the first value of a duplicated lap is kept");
  assert.deepEqual(series.drivers[2].points.map((point) => point.lap), [0, 1, 2, 3, 5], "lap 4 stays missing");
  assert.deepEqual(orderAtLap(series, 1).map((entry) => `${entry.position}:${entry.driver.code}`), ["1:BBB", "2:AAA", "3:DDD", "7:CCC"]);
  assert.deepEqual(orderAtLap(series, 4), []);
});

test("biggest climb: from the lowest position held (grid included) to the finish, classified drivers only", () => {
  assert.deepEqual(biggestClimbFigure(positionsFixture, classified), { state: "ok", value: "+5", detail: "Cal Charlie, P8 on lap 2 to P3", basis: "positions", code: "CCC" });
  // A driver who never ran lower than the grid climbs from the grid.
  const fromGrid = { ...positionsFixture, drivers: [contractDriver(3, "CCC", "Cal", "Charlie", { grid: 6, finish: 3, positions: [{ lap: 0, position: 6 }, { lap: 1, position: 5 }, { lap: 5, position: 3 }] })] };
  assert.equal(biggestClimbFigure(fromGrid, classified).detail, "Cal Charlie, P6 on the grid to P3");
  // Ties are named, never resolved silently.
  const tied = { ...positionsFixture, drivers: [
    contractDriver(1, "AAA", "Ann", "Alpha", { finish: 1, positions: [{ lap: 0, position: 3 }, { lap: 2, position: 3 }, { lap: 5, position: 1 }] }),
    contractDriver(2, "BBB", "Bea", "Bravo", { finish: 2, positions: [{ lap: 0, position: 4 }, { lap: 5, position: 2 }] }),
  ] };
  assert.deepEqual(biggestClimbFigure(tied, classified), { state: "ok", value: "+2", detail: "Tied: Ann Alpha and Bea Bravo", basis: "positions" });
  const flat = { ...positionsFixture, drivers: [contractDriver(1, "AAA", "Ann", "Alpha", { finish: 1, positions: [{ lap: 0, position: 1 }, { lap: 5, position: 1 }] })] };
  assert.equal(biggestClimbFigure(flat, classified).value, "0");
});

test("biggest climb: falls back to grid → finish from the classification, and says so", () => {
  const expected = { state: "ok", value: "+3", detail: "Cal Charlie, P6 to P3", basis: "grid", code: "CCC" };
  assert.deepEqual(biggestClimbFigure(null, classified), expected);
  assert.deepEqual(biggestClimbFigure({ availability: "unavailable", reason: "Not yet", drivers: [] }, classified), expected);
  // Positions published only for the grid (no lap run yet): not a race climb.
  assert.deepEqual(biggestClimbFigure({ drivers: [contractDriver(1, "AAA", "Ann", "Alpha", { finish: 1, positions: [{ lap: 0, position: 3 }] })] }, classified), expected);
  assert.deepEqual(biggestClimbFigure(null, []), { state: "unavailable", reason: "Lap-by-lap positions are not published and no classified result has a grid position." });
});
