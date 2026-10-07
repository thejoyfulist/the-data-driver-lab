/**
 * Source of the evaluation questions. `build-truth.mjs` runs each `truth`
 * function on the RAW public API response (not on the tool catalogue) and
 * freezes the result, with the API responses, in truth.json and
 * api-snapshot.json. The mock model follows `mock` (tool steps, then a value
 * read from the TOOL output), so the mock run checks the catalogue against
 * the raw API.
 *
 * kind "answer": every `expect` item must appear in the answer (an array is a
 * list of accepted spellings). kind "refusal": the answer must say the data
 * is not available and must not contain any `forbid` item.
 */

const name = (row) => `${row.first_name} ${row.last_name}`;
const num = (value) => String(Number(value));
const rows = (body) => (Array.isArray(body?.data) ? body.data : []);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Accepted spellings of an ISO date. */
export function dateForms(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const monthName = MONTHS[month - 1];
  return [iso, `${day} ${monthName}`, `${monthName} ${day}`, `${day}th ${monthName}`, `${day} ${monthName.slice(0, 3)}`];
}

const race = (season, api_round, query) => [{ name: "f1_resolve_race", arguments: { season, query } }];
const step = (toolName, args) => [{ name: toolName, arguments: args }];

const CAL26 = "/v1/f1/calendar/2026";
const DRV26 = "/v1/f1/standings/drivers/2026";
const CON26 = "/v1/f1/standings/constructors/2026";
const r26 = (round, suffix) => `/v1/f1/races/2026/${round}/${suffix}`;

/** @type {Array<Record<string, any>>} */
export const SPECS = [
  // ── Calendar ───────────────────────────────────────────────────────
  {
    id: "cal-singapore-date", category: "calendar", kind: "answer",
    question: "On what date is the 2026 Singapore Grand Prix?",
    sources: [CAL26],
    truth: ({ get }) => [dateForms(rows(get(CAL26)).find((r) => r.round === 18).date)],
    mock: { steps: [race(2026, 18, "Singapore Grand Prix")], read: { tool: "f1_resolve_race", path: "data.candidates.0.date" }, template: "The 2026 Singapore Grand Prix is scheduled for {value}." },
  },
  {
    id: "cal-japan-circuit", category: "calendar", kind: "answer",
    question: "At which circuit was the 2026 Japanese Grand Prix held?",
    sources: [CAL26],
    truth: ({ get }) => [rows(get(CAL26)).find((r) => r.round === 3).circuit.name],
    mock: { steps: [race(2026, 3, "Japanese Grand Prix")], read: { tool: "f1_resolve_race", path: "data.candidates.0.circuit" }, template: "It was held at {value}." },
  },
  {
    id: "cal-azerbaijan-round", category: "calendar", kind: "answer",
    question: "Which round of the 2026 championship was the Azerbaijan Grand Prix?",
    sources: [CAL26],
    truth: ({ get }) => [num(rows(get(CAL26)).find((r) => r.round === 17).official_round)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix")], read: { tool: "f1_resolve_race", path: "data.candidates.0.official_round" }, template: "It was round {value}." },
  },
  {
    id: "cal-saudi-status", category: "calendar", kind: "answer",
    question: "Did the 2026 Saudi Arabian Grand Prix take place?",
    sources: [CAL26],
    truth: ({ get }) => [rows(get(CAL26)).find((r) => r.round === 5).status === "cancelled" ? ["cancelled", "canceled"] : "held"],
    mock: { steps: [race(2026, 5, "Saudi Arabian Grand Prix")], read: { tool: "f1_resolve_race", path: "data.candidates.0.status" }, template: "No: its status in the calendar is {value}." },
  },
  {
    id: "cal-miami-sprint", category: "calendar", kind: "answer",
    question: "In which city is the circuit of the 2026 Miami Grand Prix?",
    sources: [CAL26],
    truth: ({ get }) => [rows(get(CAL26)).find((r) => r.round === 6).circuit.city],
    mock: { steps: [race(2026, 6, "Miami Grand Prix")], read: { tool: "f1_resolve_race", path: "data.candidates.0.city" }, template: "The circuit is in {value}." },
  },
  {
    id: "cal-round-16-2026", category: "calendar", kind: "answer",
    question: "Which Grand Prix was round 16 of the 2026 season?",
    sources: [CAL26],
    truth: ({ get }) => [rows(get(CAL26)).find((r) => r.official_round === 16).name],
    mock: { steps: [race(2026, 25, "round 16")], read: { tool: "f1_resolve_race", path: "data.candidates.0.name" }, template: "Round 16 was the {value}." },
  },
  // ── Drivers' standings ─────────────────────────────────────────────
  {
    id: "wdc-leader-2026", category: "standings", kind: "answer",
    question: "Who leads the 2026 drivers' championship?",
    sources: [DRV26],
    truth: ({ get }) => [name(rows(get(DRV26))[0])],
    mock: { steps: [step("f1_driver_standings", { season: 2026, limit: 3 })], read: { tool: "f1_driver_standings", path: "data.standings.0.name" }, template: "{value} leads the championship." },
  },
  {
    id: "wdc-leader-points-2026", category: "standings", kind: "answer",
    question: "How many points does the 2026 drivers' championship leader have?",
    sources: [DRV26],
    truth: ({ get }) => [num(rows(get(DRV26))[0].points)],
    mock: { steps: [step("f1_driver_standings", { season: 2026, limit: 1 })], read: { tool: "f1_driver_standings", path: "data.standings.0.points" }, template: "The leader has {value} points." },
  },
  {
    id: "wdc-russell-points-2026", category: "standings", kind: "answer",
    question: "How many championship points does George Russell have in 2026?",
    sources: [DRV26],
    truth: ({ get }) => [num(rows(get(DRV26)).find((r) => r.driver_code === "RUS").points)],
    mock: { steps: [step("f1_driver_standings", { season: 2026 })], read: { tool: "f1_driver_standings", path: "data.standings.?code=RUS.0.points" }, template: "George Russell has {value} points." },
  },
  {
    id: "wdc-norris-wins-2026", category: "standings", kind: "answer",
    question: "How many races has Lando Norris won in 2026?",
    sources: [DRV26],
    truth: ({ get }) => [num(rows(get(DRV26)).find((r) => r.driver_code === "NOR").wins)],
    mock: { steps: [step("f1_driver_standings", { season: 2026 })], read: { tool: "f1_driver_standings", path: "data.standings.?code=NOR.0.wins" }, template: "Lando Norris has {value} wins." },
  },
  {
    id: "wdc-third-2026", category: "standings", kind: "answer",
    question: "Who is third in the 2026 drivers' championship?",
    sources: [DRV26],
    truth: ({ get }) => [name(rows(get(DRV26)).find((r) => r.position === 3))],
    mock: { steps: [step("f1_driver_standings", { season: 2026, limit: 3 })], read: { tool: "f1_driver_standings", path: "data.standings.2.name" }, template: "{value} is third." },
  },
  {
    id: "wdc-verstappen-team-2026", category: "standings", kind: "answer",
    question: "Which team does Max Verstappen drive for in 2026?",
    sources: [DRV26],
    truth: ({ get }) => [rows(get(DRV26)).find((r) => r.driver_code === "VER").team_name],
    mock: { steps: [step("f1_resolve_driver", { season: 2026, query: "Max Verstappen" })], read: { tool: "f1_resolve_driver", path: "data.candidates.0.team" }, template: "He drives for {value}." },
  },
  {
    id: "wdc-champion-2025", category: "standings", kind: "answer",
    question: "Who finished top of the 2025 drivers' championship?",
    sources: ["/v1/f1/standings/drivers/2025"],
    truth: ({ get }) => [name(rows(get("/v1/f1/standings/drivers/2025"))[0])],
    mock: { steps: [step("f1_driver_standings", { season: 2025, limit: 2 })], read: { tool: "f1_driver_standings", path: "data.standings.0.name" }, template: "{value} was top of the 2025 standings." },
  },
  {
    id: "wdc-margin-2025", category: "standings", kind: "answer",
    question: "How many points did the 2025 drivers' championship runner-up score?",
    sources: ["/v1/f1/standings/drivers/2025"],
    truth: ({ get }) => [num(rows(get("/v1/f1/standings/drivers/2025"))[1].points)],
    mock: { steps: [step("f1_driver_standings", { season: 2025, limit: 2 })], read: { tool: "f1_driver_standings", path: "data.standings.1.points" }, template: "The runner-up scored {value} points." },
  },
  // ── Constructors' standings ────────────────────────────────────────
  {
    id: "wcc-leader-2026", category: "standings", kind: "answer",
    question: "Which team leads the 2026 constructors' championship?",
    sources: [CON26],
    truth: ({ get }) => [rows(get(CON26))[0].team_name],
    mock: { steps: [step("f1_constructor_standings", { season: 2026 })], read: { tool: "f1_constructor_standings", path: "data.standings.0.team" }, template: "{value} lead the constructors' championship." },
  },
  {
    id: "wcc-ferrari-points-2026", category: "standings", kind: "answer",
    question: "How many points do Ferrari have in the 2026 constructors' championship?",
    sources: [CON26],
    truth: ({ get }) => [num(rows(get(CON26)).find((r) => r.team_name === "Ferrari").points)],
    mock: { steps: [step("f1_constructor_standings", { season: 2026 })], read: { tool: "f1_constructor_standings", path: "data.standings.?team=Ferrari.0.points" }, template: "Ferrari have {value} points." },
  },
  {
    id: "wcc-williams-position-2026", category: "standings", kind: "answer",
    question: "Where are Williams in the 2026 constructors' standings?",
    sources: [CON26],
    truth: ({ get }) => [[`P${rows(get(CON26)).find((r) => r.team_name === "Williams").position}`, `${rows(get(CON26)).find((r) => r.team_name === "Williams").position}th`]],
    mock: { steps: [step("f1_constructor_standings", { season: 2026 })], read: { tool: "f1_constructor_standings", path: "data.standings.?team=Williams.0.position" }, template: "Williams are P{value}." },
  },
  // ── Race results ───────────────────────────────────────────────────
  ...[
    ["res-azerbaijan-winner", "Who won the 2026 Azerbaijan Grand Prix?", 17, "Azerbaijan Grand Prix"],
    ["res-monaco-winner", "Who won the 2026 Monaco Grand Prix?", 8, "Monaco Grand Prix"],
    ["res-italy-winner", "Who won the 2026 Italian Grand Prix?", 15, "Italian Grand Prix"],
    ["res-britain-winner", "Who won the 2026 British Grand Prix?", 11, "British Grand Prix"],
    ["res-malaysia-winner", "Who won the race held in Malaysia in 2026?", 25, "Malaysia"],
  ].map(([id, question, round, query]) => ({
    id, category: "results", kind: "answer", question,
    sources: [CAL26, r26(round, "results")],
    truth: ({ get }) => [name(rows(get(r26(round, "results")))[0])],
    mock: { steps: [race(2026, round, query), step("f1_race_results", { season: 2026, api_round: round, limit: 3 })], read: { tool: "f1_race_results", path: "data.results.0.name" }, template: "{value} won the race." },
  })),
  {
    id: "res-azerbaijan-second", category: "results", kind: "answer",
    question: "Who finished second at the 2026 Azerbaijan Grand Prix, and from which grid position did they start?",
    sources: [CAL26, r26(17, "results")],
    truth: ({ get }) => { const row = rows(get(r26(17, "results")))[1]; return [name(row), num(row.grid)]; },
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_race_results", { season: 2026, api_round: 17, limit: 3 })], read: { tool: "f1_race_results", path: "data.results.1", fields: ["name", "grid"] }, template: "{value}" },
  },
  {
    id: "res-italy-winner-grid", category: "results", kind: "answer",
    question: "From which grid position did the winner of the 2026 Italian Grand Prix start?",
    sources: [CAL26, r26(15, "results")],
    truth: ({ get }) => [num(rows(get(r26(15, "results")))[0].grid)],
    mock: { steps: [race(2026, 15, "Italian Grand Prix"), step("f1_race_results", { season: 2026, api_round: 15, limit: 1 })], read: { tool: "f1_race_results", path: "data.results.0.grid" }, template: "The winner started from grid position {value}." },
  },
  {
    id: "res-azerbaijan-laps", category: "results", kind: "answer",
    question: "How many laps did the winner complete at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "results")],
    truth: ({ get }) => [num(rows(get(r26(17, "results")))[0].laps)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_race_results", { season: 2026, api_round: 17, limit: 1 })], read: { tool: "f1_race_results", path: "data.results.0.laps" }, template: "The winner completed {value} laps." },
  },
  {
    id: "res-hadjar-points-azerbaijan", category: "results", kind: "answer",
    question: "How many points did Isack Hadjar score at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "results")],
    truth: ({ get }) => [num(rows(get(r26(17, "results"))).find((r) => r.driver_code === "HAD").points)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_race_results", { season: 2026, api_round: 17 })], read: { tool: "f1_race_results", path: "data.results.?code=HAD.0.points" }, template: "Isack Hadjar scored {value} points." },
  },
  {
    id: "res-abu-dhabi-2025-winner", category: "results", kind: "answer",
    question: "Who won the 2025 Abu Dhabi Grand Prix?",
    sources: ["/v1/f1/calendar/2025", "/v1/f1/races/2025/24/results"],
    truth: ({ get }) => [name(rows(get("/v1/f1/races/2025/24/results"))[0])],
    mock: { steps: [race(2025, 24, "Abu Dhabi Grand Prix"), step("f1_race_results", { season: 2025, api_round: 24, limit: 1 })], read: { tool: "f1_race_results", path: "data.results.0.name" }, template: "{value} won." },
  },
  {
    id: "res-british-1950-winner", category: "results", kind: "answer",
    question: "Who won the 1950 British Grand Prix?",
    sources: ["/v1/f1/calendar/1950", "/v1/f1/races/1950/1/results"],
    truth: ({ get }) => [name(rows(get("/v1/f1/races/1950/1/results"))[0])],
    mock: { steps: [race(1950, 1, "British Grand Prix"), step("f1_race_results", { season: 1950, api_round: 1, limit: 1 })], read: { tool: "f1_race_results", path: "data.results.0.name" }, template: "{value} won." },
  },
  // ── Qualifying ─────────────────────────────────────────────────────
  {
    id: "quali-azerbaijan-pole", category: "qualifying", kind: "answer",
    question: "Who took pole position for the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "qualifying")],
    truth: ({ get }) => [name(rows(get(r26(17, "qualifying")))[0])],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_qualifying", { season: 2026, api_round: 17, limit: 3 })], read: { tool: "f1_qualifying", path: "data.qualifying.0.name" }, template: "{value} took pole." },
  },
  {
    id: "quali-azerbaijan-pole-time", category: "qualifying", kind: "answer",
    question: "What was the pole time in Q3 at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "qualifying")],
    truth: ({ get }) => [rows(get(r26(17, "qualifying")))[0].q3],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_qualifying", { season: 2026, api_round: 17, limit: 1 })], read: { tool: "f1_qualifying", path: "data.qualifying.0.q3" }, template: "The pole time was {value}." },
  },
  {
    id: "quali-leclerc-azerbaijan", category: "qualifying", kind: "answer",
    question: "Where did Charles Leclerc qualify for the 2026 Azerbaijan Grand Prix and what was his Q3 time?",
    sources: [CAL26, r26(17, "qualifying")],
    truth: ({ get }) => { const row = rows(get(r26(17, "qualifying"))).find((r) => r.driver_code === "LEC"); return [[`P${row.position}`, `${row.position}nd`, `second`], row.q3]; },
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_qualifying", { season: 2026, api_round: 17 })], read: { tool: "f1_qualifying", path: "data.qualifying.?code=LEC.0", fields: ["position", "q3"] }, template: "Charles Leclerc qualified P{value}." },
  },
  {
    id: "quali-monaco-pole", category: "qualifying", kind: "answer",
    question: "Who was on pole at the 2026 Monaco Grand Prix?",
    sources: [CAL26, r26(8, "qualifying")],
    truth: ({ get }) => [name(rows(get(r26(8, "qualifying")))[0])],
    mock: { steps: [race(2026, 8, "Monaco Grand Prix"), step("f1_qualifying", { season: 2026, api_round: 8, limit: 1 })], read: { tool: "f1_qualifying", path: "data.qualifying.0.name" }, template: "{value} was on pole." },
  },
  {
    id: "quali-abu-dhabi-2025-pole", category: "qualifying", kind: "answer",
    question: "Who took pole for the 2025 Abu Dhabi Grand Prix?",
    sources: ["/v1/f1/calendar/2025", "/v1/f1/races/2025/24/qualifying"],
    truth: ({ get }) => [name(rows(get("/v1/f1/races/2025/24/qualifying"))[0])],
    mock: { steps: [race(2025, 24, "Abu Dhabi Grand Prix"), step("f1_qualifying", { season: 2025, api_round: 24, limit: 1 })], read: { tool: "f1_qualifying", path: "data.qualifying.0.name" }, template: "{value} took pole." },
  },
  // ── Fastest laps and lap times ─────────────────────────────────────
  {
    id: "fl-azerbaijan", category: "laps", kind: "answer",
    question: "Who set the fastest lap of the 2026 Azerbaijan Grand Prix and what was the time?",
    sources: [CAL26, r26(17, "fastest-laps")],
    truth: ({ get }) => { const row = get(r26(17, "fastest-laps")).data.fastest_laps[0]; return [name(row), row.time_formatted]; },
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_fastest_laps", { season: 2026, api_round: 17, limit: 3 })], read: { tool: "f1_fastest_laps", path: "data.fastest_laps.0", fields: ["name", "time"] }, template: "The fastest lap: {value}." },
  },
  {
    id: "fl-azerbaijan-lap-number", category: "laps", kind: "answer",
    question: "On which lap was the fastest lap of the 2026 Azerbaijan Grand Prix set?",
    sources: [CAL26, r26(17, "fastest-laps")],
    truth: ({ get }) => [num(get(r26(17, "fastest-laps")).data.fastest_laps[0].lap)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_fastest_laps", { season: 2026, api_round: 17, limit: 1 })], read: { tool: "f1_fastest_laps", path: "data.fastest_laps.0.lap" }, template: "It was set on lap {value}." },
  },
  {
    id: "laps-russell-lap1-azerbaijan", category: "laps", kind: "answer",
    question: "What was George Russell's first lap time at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, DRV26, r26(17, "laps/320")],
    truth: ({ get }) => [get(r26(17, "laps/320")).data.laps.find((lap) => lap.lap_number === 1).time_formatted],
    mock: { steps: [[...race(2026, 17, "Azerbaijan Grand Prix"), { name: "f1_resolve_driver", arguments: { season: 2026, query: "George Russell" } }], step("f1_driver_laps", { season: 2026, api_round: 17, driver_id: 320, from_lap: 1, to_lap: 1 })], read: { tool: "f1_driver_laps", path: "data.laps.0.time" }, template: "His first lap was {value} (OpenF1 enrichment, CC BY-NC-SA 4.0)." },
  },
  {
    id: "laps-russell-best-azerbaijan", category: "laps", kind: "answer",
    question: "What was George Russell's best lap time at the 2026 Azerbaijan Grand Prix according to the lap data?",
    sources: [CAL26, DRV26, r26(17, "laps/320")],
    truth: ({ get }) => { const timed = get(r26(17, "laps/320")).data.laps.filter((lap) => lap.time_ms != null); return [timed.reduce((a, b) => (a.time_ms <= b.time_ms ? a : b)).time_formatted]; },
    mock: { steps: [[...race(2026, 17, "Azerbaijan Grand Prix"), { name: "f1_resolve_driver", arguments: { season: 2026, query: "Russell" } }], step("f1_driver_laps", { season: 2026, api_round: 17, driver_id: 320 })], read: { tool: "f1_driver_laps", path: "data.best_lap.time" }, template: "His best lap was {value}." },
  },
  // ── Pit stops ──────────────────────────────────────────────────────
  {
    id: "pit-russell-count-azerbaijan", category: "pit-stops", kind: "answer",
    question: "On which lap did George Russell make his pit stop at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "pitstops")],
    truth: ({ get }) => rows(get(r26(17, "pitstops"))).filter((r) => r.driver_code === "RUS").map((r) => num(r.lap)),
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_pit_stops", { season: 2026, api_round: 17, driver_code: "RUS" })], read: { tool: "f1_pit_stops", path: "data.stops.*.lap" }, template: "He pitted on lap {value}." },
  },
  {
    id: "pit-quickest-azerbaijan", category: "pit-stops", kind: "answer",
    question: "Who had the quickest pit stop at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "pitstops")],
    truth: ({ get }) => [name(rows(get(r26(17, "pitstops"))).reduce((a, b) => (a.duration_ms <= b.duration_ms ? a : b)))],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_pit_stops", { season: 2026, api_round: 17 })], read: { tool: "f1_pit_stops", path: "data.quickest_stop.name" }, template: "{value} had the quickest stop." },
  },
  {
    id: "pit-total-azerbaijan", category: "pit-stops", kind: "answer",
    question: "How many pit stops were made in total at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "pitstops")],
    truth: ({ get }) => [num(rows(get(r26(17, "pitstops"))).length)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_pit_stops", { season: 2026, api_round: 17 })], read: { tool: "f1_pit_stops", path: "data.stop_count" }, template: "{value} pit stops were made." },
  },
  // ── Safety cars, incidents, weather (OpenF1 enrichment) ────────────
  {
    id: "sc-azerbaijan-count", category: "race-control", kind: "answer",
    question: "How many safety car periods were there at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "safety-cars")],
    truth: ({ get }) => [[num(rows(get(r26(17, "safety-cars"))).length), ["zero", "one", "two", "three", "four"][rows(get(r26(17, "safety-cars"))).length]]],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_safety_cars", { season: 2026, api_round: 17 })], read: { tool: "f1_safety_cars", path: "data.periods", count: true }, template: "There were {value} safety car periods (OpenF1 enrichment)." },
  },
  {
    id: "sc-azerbaijan-first-lap", category: "race-control", kind: "answer",
    question: "On which lap did the first safety car come out at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "safety-cars")],
    truth: ({ get }) => [num(rows(get(r26(17, "safety-cars")))[0].start_lap)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_safety_cars", { season: 2026, api_round: 17 })], read: { tool: "f1_safety_cars", path: "data.periods.0.start_lap" }, template: "The first safety car came out on lap {value}." },
  },
  {
    id: "sc-malaysia-vsc", category: "race-control", kind: "answer",
    question: "On which lap did the virtual safety car start in the 2026 race held in Malaysia?",
    sources: [CAL26, r26(25, "safety-cars")],
    truth: ({ get }) => [num(rows(get(r26(25, "safety-cars"))).find((r) => r.type === "VSC").start_lap)],
    mock: { steps: [race(2026, 25, "Malaysia"), step("f1_safety_cars", { season: 2026, api_round: 25 })], read: { tool: "f1_safety_cars", path: "data.periods.?type=VSC.0.start_lap" }, template: "The virtual safety car started on lap {value}." },
  },
  {
    id: "inc-azerbaijan-dnf", category: "race-control", kind: "answer",
    question: "Which drivers retired from the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "incidents")],
    truth: ({ get }) => rows(get(r26(17, "incidents"))).filter((r) => r.type === "dnf").map((r) => r.driver.split(" ").slice(-1)[0]),
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_incidents", { season: 2026, api_round: 17 })], read: { tool: "f1_incidents", path: "data.incidents.?type=dnf.*.driver" }, template: "Retirements: {value}." },
  },
  {
    id: "wx-azerbaijan-air", category: "weather", kind: "answer",
    question: "What was the air temperature at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "weather")],
    truth: ({ get }) => [num(get(r26(17, "weather")).data.air_temp)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_weather", { season: 2026, api_round: 17 })], read: { tool: "f1_weather", path: "data.weather.air_temp_c" }, template: "The air temperature was {value} °C." },
  },
  {
    id: "wx-azerbaijan-track", category: "weather", kind: "answer",
    question: "What was the track temperature at the 2026 Azerbaijan Grand Prix?",
    sources: [CAL26, r26(17, "weather")],
    truth: ({ get }) => [num(get(r26(17, "weather")).data.track_temp)],
    mock: { steps: [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_weather", { season: 2026, api_round: 17 })], read: { tool: "f1_weather", path: "data.weather.track_temp_c" }, template: "The track temperature was {value} °C." },
  },
  // ── Forecasts and head-to-head ─────────────────────────────────────
  {
    id: "fc-singapore-favourite", category: "forecast", kind: "answer",
    question: "According to The Data Driver model, who is the favourite to win the 2026 Singapore Grand Prix?",
    sources: [CAL26, "/v1/f1/predictions/race/2026/18"],
    truth: ({ get }) => [get("/v1/f1/predictions/race/2026/18").data.predictions[0].driver_name],
    mock: { steps: [race(2026, 18, "Singapore Grand Prix"), step("f1_race_forecast", { season: 2026, api_round: 18, limit: 3 })], read: { tool: "f1_race_forecast", path: "data.forecast.0.name" }, template: "The model forecast favours {value} (a forecast, not a result)." },
  },
  {
    id: "fc-singapore-win-pct", category: "forecast", kind: "answer",
    question: "What win probability does The Data Driver model give the favourite for the 2026 Singapore Grand Prix?",
    sources: [CAL26, "/v1/f1/predictions/race/2026/18"],
    truth: ({ get }) => { const p = get("/v1/f1/predictions/race/2026/18").data.predictions[0].p_win * 100; return [[`${(Math.round(p * 10) / 10).toFixed(1)}%`, `${(Math.round(p * 10) / 10).toFixed(1)} %`, `${Math.round(p)}%`, `${Math.round(p)} %`, `${Math.round(p)} per cent`]]; },
    mock: { steps: [race(2026, 18, "Singapore Grand Prix"), step("f1_race_forecast", { season: 2026, api_round: 18, limit: 1 })], read: { tool: "f1_race_forecast", path: "data.forecast.0.win_pct" }, template: "The model gives the favourite a {value}% chance of winning (a forecast)." },
  },
  {
    id: "fc-singapore-pole", category: "forecast", kind: "answer",
    question: "Who does the qualifying forecast expect to take pole at the 2026 Singapore Grand Prix?",
    sources: [CAL26, "/v1/f1/predictions/qualifying/2026/18"],
    truth: ({ get }) => [rows(get("/v1/f1/predictions/qualifying/2026/18"))[0].driver_name],
    mock: { steps: [race(2026, 18, "Singapore Grand Prix"), step("f1_qualifying_forecast", { season: 2026, api_round: 18, limit: 3 })], read: { tool: "f1_qualifying_forecast", path: "data.forecast.0.name" }, template: "The qualifying forecast favours {value} for pole." },
  },
  {
    id: "h2h-russell-antonelli-season", category: "head-to-head", kind: "answer",
    question: "In 2026 races, how many times has George Russell finished ahead of Kimi Antonelli, and vice versa?",
    sources: [DRV26, "/v1/f1/drivers/320/head-to-head/539"],
    truth: ({ get }) => { const h = get("/v1/f1/drivers/320/head-to-head/539").data.season_race_h2h; return [num(h.driver1_wins), num(h.driver2_wins)]; },
    mock: { steps: [[{ name: "f1_resolve_driver", arguments: { season: 2026, query: "George Russell" } }, { name: "f1_resolve_driver", arguments: { season: 2026, query: "Kimi Antonelli" } }], step("f1_head_to_head", { driver_id_1: 320, driver_id_2: 539 })], read: { tool: "f1_head_to_head", path: "data.races_this_season", fields: ["driver1_ahead", "driver2_ahead"] }, template: "Russell ahead / Antonelli ahead: {value}." },
  },
  {
    id: "h2h-russell-antonelli-quali", category: "head-to-head", kind: "answer",
    question: "What is the all-time qualifying head-to-head between George Russell and Kimi Antonelli?",
    sources: [DRV26, "/v1/f1/drivers/320/head-to-head/539"],
    truth: ({ get }) => { const h = get("/v1/f1/drivers/320/head-to-head/539").data.quali_h2h; return [num(h.driver1_wins), num(h.driver2_wins)]; },
    mock: { steps: [[{ name: "f1_resolve_driver", arguments: { season: 2026, query: "Russell" } }, { name: "f1_resolve_driver", arguments: { season: 2026, query: "Antonelli" } }], step("f1_head_to_head", { driver_id_1: 320, driver_id_2: 539 })], read: { tool: "f1_head_to_head", path: "data.qualifying_all_time", fields: ["driver1_ahead", "driver2_ahead"] }, template: "Qualifying head-to-head (Russell, Antonelli): {value}." },
  },
  // ── Refusals: the data is not published or not in the catalogue ────
  ...[
    ["ref-singapore-winner", "Who won the 2026 Singapore Grand Prix?", [race(2026, 18, "Singapore Grand Prix"), step("f1_race_results", { season: 2026, api_round: 18 })], [r26(18, "results")], ["won the singapore"]],
    ["ref-bahrain-winner", "Who won the 2026 Bahrain Grand Prix in Sakhir?", [race(2026, 4, "Bahrain Grand Prix"), step("f1_race_results", { season: 2026, api_round: 4 })], [r26(4, "results")], ["won the bahrain"]],
    ["ref-azerbaijan-fp1", "What was the fastest time in FP1 at the 2026 Azerbaijan Grand Prix?", [race(2026, 17, "Azerbaijan Grand Prix"), step("f1_practice_best", { season: 2026, api_round: 17, session: "FP1" })], [r26(17, "practice/FP1/best")], []],
    ["ref-singapore-weather", "What was the track temperature at the 2026 Singapore Grand Prix?", [race(2026, 18, "Singapore Grand Prix"), step("f1_weather", { season: 2026, api_round: 18 })], [r26(18, "weather")], []],
    ["ref-las-vegas-pits", "How many pit stops were made at the 2026 Las Vegas Grand Prix?", [race(2026, 22, "Las Vegas Grand Prix"), step("f1_pit_stops", { season: 2026, api_round: 22 })], [r26(22, "pitstops")], []],
  ].map(([id, question, steps, extra, forbid]) => ({
    id, category: "refusal", kind: "refusal", question, sources: [CAL26, ...extra], forbid,
    truth: () => [],
    mock: { steps, read: { tool: steps.at(-1)[0].name, path: "data.__missing__" }, template: "{value}" },
  })),
  ...[
    ["ref-salary", "What is Max Verstappen's salary in 2026?"],
    ["ref-tyres", "Which tyre compound did George Russell start the 2026 Azerbaijan Grand Prix on?"],
    ["ref-attendance", "How many spectators attended the 2026 Monaco Grand Prix?"],
    ["ref-2027-champion", "Who will win the 2027 drivers' championship?"],
    ["ref-top-speed", "What was Max Verstappen's top speed at the 2026 Italian Grand Prix?"],
  ].map(([id, question]) => ({
    id, category: "refusal", kind: "refusal", question, sources: [], forbid: [],
    truth: () => [],
    mock: { steps: [], template: "" },
  })),
];
