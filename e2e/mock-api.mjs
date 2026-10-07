import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.TDD_PLAYWRIGHT_API_PORT ?? "4011", 10);

const distributions = [
  [0.31, 0.2, 0.14, 0.09, 0.06, 0.04, 0.03, 0.02, 0.015, 0.01, 0.008, 0.007, 0.006, 0.005, 0.004, 0.003, 0.002, 0.001, 0.001, 0.001],
  [0.24, 0.22, 0.16, 0.11, 0.07, 0.045, 0.03, 0.02, 0.015, 0.01, 0.008, 0.007, 0.006, 0.005, 0.004, 0.003, 0.002, 0.001, 0.001, 0.001],
  [0.18, 0.19, 0.17, 0.13, 0.09, 0.06, 0.04, 0.028, 0.02, 0.015, 0.01, 0.008, 0.006, 0.005, 0.004, 0.003, 0.002, 0.001, 0.001, 0.001],
  [0.12, 0.14, 0.16, 0.15, 0.11, 0.08, 0.06, 0.04, 0.03, 0.02, 0.015, 0.01, 0.008, 0.006, 0.005, 0.004, 0.003, 0.002, 0.001, 0.001],
  [0.08, 0.1, 0.12, 0.14, 0.13, 0.1, 0.075, 0.055, 0.04, 0.03, 0.02, 0.015, 0.01, 0.008, 0.006, 0.005, 0.004, 0.003, 0.002, 0.001],
];

const drivers = [
  [4, "NOR", "Lando Norris", 0.31, 0.65, 0.86, 0.07, 2.4, 18.2],
  [81, "PIA", "Oscar Piastri", 0.24, 0.62, 0.84, 0.08, 2.8, 16.9],
  [1, "VER", "Max Verstappen", 0.18, 0.52, 0.79, 0.09, 3.4, 14.8],
  [63, "RUS", "George Russell", 0.12, 0.39, 0.71, 0.1, 4.2, 11.5],
  [44, "HAM", "Lewis Hamilton", 0.08, 0.31, 0.66, 0.11, 5.1, 9.4],
];

// The repaired backend certifies official_round values with this marker; the
// site shows a round number only when it is present (site-display.mjs).
const OFFICIAL_ROUND_BASIS = "formula1.com-chronological-v2";

function envelope(data, { certified = true } = {}) {
  return {
    status: "success",
    data,
    meta: {
      source: "playwright-fixture",
      series: "f1",
      timestamp: "2026-08-14T12:00:00Z",
      cache_ttl: 0,
      ...(certified ? { official_round_basis: OFFICIAL_ROUND_BASIS } : {}),
    },
  };
}

// Internal round keys differ from the formula1.com numbering in 2026 (two
// cancelled rounds), so the fixture's official rounds are 11 and 12.
const calendar2026 = [
  { round: 13, official_round: 11, name: "Previous Fixture Grand Prix", date: "2026-08-16", time: "14:00:00Z", is_sprint: false, status: "completed", circuit: { name: "Previous Fixture Circuit", city: "Archive City", country: "Test Country" } },
  { round: 14, official_round: 12, name: "Fixture Grand Prix", date: "2026-08-30", time: "14:00:00Z", is_sprint: false, status: "upcoming", circuit: { name: "Fixture Circuit", city: "Test City", country: "Test Country" } },
];
// Older API shape without official_round: the site must not print races.round.
const legacyCalendar2025 = calendar2026.map(({ official_round: _officialRound, ...race }) => ({
  ...race,
  date: race.date.replace("2026", "2025"),
  status: "completed",
}));

// Pre-repair API shape (production on 2026-09-23): official_round present but
// uncertified and stale (a missing race shifts it by one). Never displayed.
const staleCalendar2024 = calendar2026.map((race) => ({
  ...race,
  official_round: race.official_round - 1,
  date: race.date.replace("2026", "2024"),
  status: "completed",
}));

const routes = new Map([
  ["/v1/health", envelope({ status: "ok" })],
  ["/v1/f1/calendar/next", envelope({
    round: 14,
    name: "Fixture Grand Prix",
    date: "2026-08-30",
    status: "scheduled",
  })],
  ["/v1/f1/predictions/track-record", envelope({
    total_scored: 13,
    n_races_scored: 13,
    brier_score: 0.164,
    skill_score: 0.12,
    baselines: { grid: { brier: 0.186, skill_score: 0 }, championship: { brier: 0.2, skill_score: 0 }, random: { brier: 0.25, skill_score: 0 }, vs_grid_pct: 12 },
    calibration: [],
    history: [{ race_id: 13, race_name: "Previous Fixture Grand Prix", season: 2026, round: 13, brier_score: 0.164, grid_baseline: 0.186, beats_grid: true, top1_correct: true, top3_correct: true, top3_overlap: 2, predicted_winner: "Lando Norris", actual_winner: "Lando Norris", n_predictions: 20 }],
    backtest: null,
  })],
  ["/v1/f1/standings/drivers/2026", envelope(drivers.map(([driverId, code, name], index) => ({
    position: index + 1,
    driver_id: driverId,
    driver_code: code,
    first_name: String(name).split(" ")[0],
    last_name: String(name).split(" ").slice(1).join(" "),
    team_name: ["McLaren", "McLaren", "Red Bull Racing", "Mercedes", "Ferrari"][index],
    points: [219, 198, 172, 151, 139][index],
    wins: [4, 3, 2, 1, 1][index],
  })))],
  ["/v1/f1/standings/constructors/2026", envelope([
    { position: 1, team_id: 1, team_name: "McLaren", points: 417, wins: 7 },
    { position: 2, team_id: 2, team_name: "Red Bull Racing", points: 214, wins: 2 },
    { position: 3, team_id: 3, team_name: "Mercedes", points: 202, wins: 1 },
    { position: 4, team_id: 4, team_name: "Ferrari", points: 193, wins: 1 },
  ])],
  ["/v1/f1/calendar/2026", envelope(calendar2026)],
  ["/v1/f1/calendar/2025", envelope(legacyCalendar2025)],
  ["/v1/f1/calendar/2024", envelope(staleCalendar2024, { certified: false })],
  ["/v1/f1/circuits", envelope([
    { id: 13, name: "Previous Fixture Circuit", country: "Test Country", city: "Archive City", length_km: 5.1, turns: 16 },
    { id: 14, name: "Fixture Circuit", country: "Test Country", city: "Test City", length_km: 5.4, turns: 18 },
  ])],
  ["/v1/f1/predictions/championship/2026", envelope({
    season: 2026,
    standings: drivers.map(([driverId, code, name], index) => ({ driver_id: driverId, driver_code: code, driver_name: name, current_points: [219, 198, 172, 151, 139][index], expected_points: [361, 342, 301, 277, 260][index], title_probability: [0.39, 0.31, 0.17, 0.08, 0.05][index] })),
    remaining_races: 10,
    model_version: "playwright-fixture",
  })],
  ["/v1/f1/races/2026/13/results", envelope(drivers.map(([driverId, code, name], index) => ({
    position: index + 1,
    driver_id: driverId,
    driver_code: code,
    first_name: String(name).split(" ")[0],
    last_name: String(name).split(" ").slice(1).join(" "),
    team_name: ["McLaren", "McLaren", "Red Bull Racing", "Mercedes", "Ferrari"][index],
    grid: [2, 1, 4, 5, 7][index],
    laps: 57,
    status: "Finished",
    points: [25, 18, 15, 12, 10][index],
  })))],
  ["/v1/f1/predictions/race/2026/13", envelope({
    race: "Previous Fixture Grand Prix",
    round: 13,
    year: 2026,
    date: "2026-08-16",
    status: "completed",
    model_version: "playwright-fixture",
    circuit: { name: "Previous Fixture Circuit", city: "Archive City", country: "Test Country" },
    predictions: drivers.map(([driverId, code, name, win, podium, points, dnf, position, expectedPoints], index) => ({ rank: index + 1, driver_id: driverId, driver_code: code, driver_name: name, probability: win, p_win: win, p_podium: podium, p_points: points, p_dnf: dnf, e_position: position, e_points: expectedPoints, position_distribution: distributions[index] })),
  })],
  ["/v1/f1/articles", envelope([
    { slug: "fixture-analysis", title: "Fixture analysis", subtitle: "Evidence", description: "Fixture", author: "The Data Driver", published_date: "2026-08-14", reading_time: 5, category: "analysis", tags: [], sections: [] },
    { slug: "fixture-methodology", title: "Fixture methodology", subtitle: "Method", description: "Fixture", author: "The Data Driver", published_date: "2026-08-13", reading_time: 6, category: "methodology", tags: [], sections: [] },
    { slug: "fixture-preview", title: "Fixture preview", subtitle: "Preview", description: "Fixture", author: "The Data Driver", published_date: "2026-08-12", reading_time: 4, category: "preview", tags: [], sections: [] },
  ])],
  ["/v1/f1/predictions/binary/2026/14", envelope(
    Array.from({ length: 30 }, (_, i) => ({
      type: i % 3 === 0 ? "winner" : i % 3 === 1 ? "podium" : "teammate",
      title: i % 3 === 0 ? `Driver ${i} wins the Fixture Grand Prix` : i % 3 === 1 ? `Driver ${i} on the podium` : `Driver ${i} beats teammate`,
      yes_probability: Math.max(0.05, 0.6 - i * 0.015),
      no_probability: Math.min(0.95, 0.4 + i * 0.015),
      description: `Fixture binary prediction ${i}`,
      category: "race",
      driver_code: i % 3 === 0 ? "NOR" : null,
    })),
  )],
  ["/v1/series", envelope([])],
  ["/v1/f1/predictions/race/2026/14", envelope({
    race: "Fixture Grand Prix",
    round: 14,
    year: 2026,
    date: "2026-08-30",
    status: "scheduled",
    model_version: "playwright-fixture",
    circuit: { name: "Fixture Circuit", city: "Test City", country: "Test Country" },
    predictions: drivers.map(([driverId, code, name, win, podium, points, dnf, position, expectedPoints], index) => ({
      rank: index + 1,
      driver_id: driverId,
      driver_code: code,
      driver_name: name,
      probability: win,
      p_win: win,
      p_podium: podium,
      p_points: points,
      p_dnf: dnf,
      e_position: position,
      e_points: expectedPoints,
      position_distribution: distributions[index],
    })),
  })],
]);

// Data Lab race views: laps, pit stops, fastest laps, safety
// cars, incidents, weather, head-to-head and an empty practice session.
function fixtureLaps(code, first, last, offsetMs, pitLap) {
  return Array.from({ length: 57 }, (_, index) => {
    const lap = index + 1;
    const base = lap === 1 ? 98_000 : 91_000 + offsetMs + ((lap * 37) % 600) - lap * 8;
    const time = lap === pitLap ? base + 21_000 : base;
    return { lap_number: lap, driver_code: code, first_name: first, last_name: last, position: null, time_ms: time, time_formatted: null, sector_1_ms: null, sector_2_ms: null, sector_3_ms: null };
  });
}
const openf1Meta = { source: "openf1.org", license: "CC BY-NC-SA 4.0", license_url: "https://creativecommons.org/licenses/by-nc-sa/4.0/", data_fetched_at: "2026-08-16T18:00:00Z" };
function withMeta(payload, extra) {
  return { ...payload, meta: { ...payload.meta, ...extra } };
}
for (const [driverId, code, name, offset, pitLap] of [[4, "NOR", "Lando Norris", 0, 22], [81, "PIA", "Oscar Piastri", 140, 21], [1, "VER", "Max Verstappen", 90, 24]]) {
  const [first, ...rest] = String(name).split(" ");
  routes.set(`/v1/f1/races/2026/13/laps/${driverId}`, withMeta(envelope({ year: 2026, round: 13, driver_id: String(driverId), laps: fixtureLaps(code, first, rest.join(" "), offset, pitLap) }), openf1Meta));
}
routes.set("/v1/f1/races/2026/13/pitstops", envelope([
  { stop: 1, lap: 22, duration_ms: 21_400, first_name: "Lando", last_name: "Norris", driver_code: "NOR", source: "formula1.com/pit-stop-summary" },
  { stop: 1, lap: 21, duration_ms: 20_900, first_name: "Oscar", last_name: "Piastri", driver_code: "PIA", source: "formula1.com/pit-stop-summary" },
  { stop: 1, lap: 24, duration_ms: 22_100, first_name: "Max", last_name: "Verstappen", driver_code: "VER", source: "formula1.com/pit-stop-summary" },
  { stop: 1, lap: 18, duration_ms: 23_000, first_name: "George", last_name: "Russell", driver_code: "RUS", source: "formula1.com/pit-stop-summary" },
  { stop: 2, lap: 40, duration_ms: 21_800, first_name: "George", last_name: "Russell", driver_code: "RUS", source: "formula1.com/pit-stop-summary" },
]));
routes.set("/v1/f1/races/2026/13/fastest-laps", envelope({
  year: 2026,
  round: 13,
  availability: "completed",
  fastest_laps: drivers.map(([, code, name], index) => ({ rank: index + 1, driver_code: code, first_name: String(name).split(" ")[0], last_name: String(name).split(" ").slice(1).join(" "), lap: 50 + index, time_ms: 90_500 + index * 210, time_formatted: `1:30.${String(500 + index * 210).padStart(3, "0")}`, gap_ms: index * 210 })),
}));
routes.set("/v1/f1/races/2026/13/safety-cars", withMeta(envelope([{ type: "SC", start_lap: 9, end_lap: 12, reason: null }, { type: "VSC", start_lap: 43, end_lap: null, reason: null }]), openf1Meta));
routes.set("/v1/f1/races/2026/13/incidents", withMeta(envelope([{ type: "safety_car", incident_type: "SC", lap: 9, description: null }, { type: "dnf", driver: "Fixture Driver", description: "DNF" }]), openf1Meta));
routes.set("/v1/f1/races/2026/13/weather", withMeta(envelope({ air_temp: 27.9, track_temp: 32.8, humidity: 61, wind_speed: 2, wind_direction: 72, rainfall: false, timestamp: "2026-08-16T14:00:00Z" }), openf1Meta));
// Practice and telemetry shapes: non-empty practice and telemetry,
// and `{ availability: "unavailable", reason }` for unpublished datasets.
function unavailable(reason) {
  return envelope({ availability: "unavailable", reason });
}
// /practice is paginated (100 rows per page by default): page 1 holds only
// Norris' and Piastri's laps, Hamilton's best lap is on a later page. The
// Lab must read /practice/{session}/best, not take minima over this page.
routes.set("/v1/f1/races/2026/13/practice", withMeta(envelope(
  ["NOR", "PIA"].flatMap((code, driverIndex) => Array.from({ length: 50 }, (_, index) => ({
    session: "FP1", lap_number: index + 1, time_ms: 82_000 + driverIndex * 300 + index * 10, sector1: null, sector2: null, sector3: null,
    compound: null, tyre_age: null, stint_number: null, is_pit_out: index === 0,
    first_name: code === "NOR" ? "Lando" : "Oscar", last_name: code === "NOR" ? "Norris" : "Piastri", driver_code: code,
  }))),
), { ...openf1Meta, total: 160, page: 1, per_page: 100 }));
routes.set("/v1/f1/races/2026/13/practice/FP1/best", withMeta(envelope({
  session: "FP1",
  classification: [
    { driver_code: "HAM", first_name: "Lewis", last_name: "Hamilton", best_ms: 81_874, rank: 1, gap_ms: 0 },
    { driver_code: "NOR", first_name: "Lando", last_name: "Norris", best_ms: 82_000, rank: 2, gap_ms: 126 },
    { driver_code: "PIA", first_name: "Oscar", last_name: "Piastri", best_ms: 82_300, rank: 3, gap_ms: 426 },
  ],
}), openf1Meta));
routes.set("/v1/f1/races/2026/13/practice/FP2/best", unavailable("No attributed timed laps have been ingested for FP2 at this race."));
// FP3 best answers 503 (see errorRoutes): the table must say it is partial.
for (const session of ["FP1", "FP2", "FP3"]) {
  routes.set(`/v1/f1/races/2026/14/practice/${session}/best`, unavailable(`No attributed timed laps have been ingested for ${session} at this race.`));
}
routes.set("/v1/f1/races/2026/13/telemetry/4", withMeta(envelope({
  year: 2026,
  round: 13,
  driver_id: 4,
  driver_code: "NOR",
  first_name: "Lando",
  last_name: "Norris",
  samples: Array.from({ length: 240 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 7, 16, 13, 3, 0) + index * 270).toISOString(),
    speed_kph: 120 + Math.round(180 * Math.abs(Math.sin(index / 18))),
    throttle_pct: 100, brake_pct: 0, n_gear: 7, rpm: 11_000, drs: 0,
  })),
}), { ...openf1Meta, total: 31_874, page: 1, per_page: 2_000 }));
routes.set("/v1/f1/races/2026/14/telemetry/4", unavailable("Complete, source-verified race telemetry is not available for this race."));
routes.set("/v1/f1/drivers/4/head-to-head/81", envelope({
  driver1: { id: 4, code: "NOR", first_name: "Lando", last_name: "Norris" },
  driver2: { id: 81, code: "PIA", first_name: "Oscar", last_name: "Piastri" },
  race_h2h: { driver1_wins: 30, driver2_wins: 22, total: 52 },
  season_race_h2h: { driver1_wins: 7, driver2_wins: 4, total: 11 },
  quali_h2h: { driver1_wins: 31, driver2_wins: 21, total: 52 },
  prediction: null,
}));

// The legacy season reuses the 2026 fixture payloads.
for (const [legacyPath, sourcePath] of [
  ["/v1/f1/races/2025/13/incidents", "/v1/f1/races/2026/13/incidents"],
  ["/v1/f1/races/2025/13/pitstops", "/v1/f1/races/2026/13/pitstops"],
  ["/v1/f1/races/2025/13/weather", "/v1/f1/races/2026/13/weather"],
  ["/v1/f1/standings/drivers/2025", "/v1/f1/standings/drivers/2026"],
  ["/v1/f1/races/2025/13/results", "/v1/f1/races/2026/13/results"],
  ["/v1/f1/predictions/race/2025/13", "/v1/f1/predictions/race/2026/13"],
]) {
  routes.set(legacyPath, routes.get(sourcePath));
}

// The stale season reuses them too, without the certification marker.
for (const [stalePath, sourcePath] of [
  ["/v1/f1/standings/drivers/2024", "/v1/f1/standings/drivers/2026"],
  ["/v1/f1/races/2024/13/results", "/v1/f1/races/2026/13/results"],
  ["/v1/f1/predictions/race/2024/13", "/v1/f1/predictions/race/2026/13"],
]) {
  const source = routes.get(sourcePath);
  const data = Array.isArray(source.data) ? source.data : { ...source.data, official_round: 10 };
  routes.set(stalePath, envelope(data, { certified: false }));
}

// Endpoints that fail upstream, to check that the Lab reports an outage
// instead of an absence of events.
const errorRoutes = new Map([
  ["/v1/f1/calendar/2098", 503],
  ["/v1/f1/standings/drivers/2098", 503],
  ["/v1/f1/races/2026/13/practice/FP3/best", 503],
  ["/v1/f1/races/2025/13/safety-cars", 503],
]);

const requestCounts = new Map();
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
  if (path === "/__requests") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(Object.fromEntries(requestCounts)));
    return;
  }
  requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
  if (request.method === "GET" && errorRoutes.has(path)) {
    response.writeHead(errorRoutes.get(path), { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "error", detail: "fixture upstream outage" }));
    return;
  }
  if (request.method !== "GET" || !routes.has(path)) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "error", detail: "fixture route not found" }));
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(routes.get(path)));
});

server.listen(port, host, () => {
  console.log(`TDD Playwright API fixture listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
