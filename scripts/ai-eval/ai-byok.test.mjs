import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  boundRows,
  createF1ToolRunner,
  createProxyFetcher,
  createSnapshotFetcher,
  F1_TOOLS,
  fitResult,
  MAX_RESULT_CHARS,
  MAX_TEXT_CHARS,
  TEXT_TRUNCATION_MARK,
  toolJsonSchemas,
} from "../../src/lib/f1-tools/catalogue.mjs";
import { matchDrivers, matchRaces } from "../../src/lib/f1-tools/resolve.mjs";
import { isAllowedProxyPath } from "../../src/lib/proxy-allowlist.mjs";
import { aiConnectOrigins, checkSettings, normaliseHost, parseConnectOrigins, PROVIDER_CONNECT_ORIGINS, PROVIDERS, validateBaseURL } from "../../src/lib/ai-byok/providers.mjs";
import { forgetSettings, loadSettings, saveSettings, STORAGE_KEY } from "../../src/lib/ai-byok/key-store.mjs";
import { buildSystemPrompt, collectSources, createAiTools } from "../../src/lib/ai-byok/agent.mjs";
import { composeAnswer, readPath, REFUSAL } from "./fake-openai.mjs";
import { containsValue, extractStructured, gradeAnswer, isRefusal, STRUCTURED_ANSWER_RULE, summarise, valueMatches, valueStance } from "./grade.mjs";

const snapshot = JSON.parse(readFileSync(new URL("./api-snapshot.json", import.meta.url), "utf8")).responses;
const truth = JSON.parse(readFileSync(new URL("./truth.json", import.meta.url), "utf8"));
const certified = { official_round_basis: "formula1.com-chronological-v2" };
const ok = (data, meta = {}) => ({ status: 200, body: { status: "ok", data, meta: { source: "tdd", ...certified, ...meta } } });
const runnerFor = (responses) => createF1ToolRunner({ fetchJson: createSnapshotFetcher(responses) });

// Sample input for every tool, used to check paths and schemas.
const SAMPLE_INPUT = {
  f1_resolve_race: { season: 2026, query: "Monza" },
  f1_resolve_driver: { season: 2026, query: "VER" },
  f1_calendar: { season: 2026 },
  f1_next_race: {},
  f1_driver_standings: { season: 2026 },
  f1_constructor_standings: { season: 2026 },
  f1_race_results: { season: 2026, api_round: 17 },
  f1_qualifying: { season: 2026, api_round: 17 },
  f1_fastest_laps: { season: 2026, api_round: 17 },
  f1_practice_best: { season: 2026, api_round: 17, session: "FP2" },
  f1_driver_laps: { season: 2026, api_round: 17, driver_id: 320 },
  f1_pit_stops: { season: 2026, api_round: 17 },
  f1_stints: { season: 2026, api_round: 17 },
  f1_positions: { season: 2026, api_round: 17 },
  f1_safety_cars: { season: 2026, api_round: 17 },
  f1_incidents: { season: 2026, api_round: 17 },
  f1_weather: { season: 2026, api_round: 17 },
  f1_race_forecast: { season: 2026, api_round: 18 },
  f1_qualifying_forecast: { season: 2026, api_round: 18 },
  f1_head_to_head: { driver_id_1: 320, driver_id_2: 539 },
  f1_race_data_status: { season: 2026, api_round: 17 },
};

// ── Catalogue ──────────────────────────────────────────────────────────

test("catalogue: unique snake_case names, a description and a sample for every tool", () => {
  const names = F1_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 15);
  for (const tool of F1_TOOLS) {
    assert.match(tool.name, /^f1_[a-z0-9_]+$/);
    assert.ok(tool.description.length > 40, tool.name);
    assert.ok(tool.name in SAMPLE_INPUT, `no sample for ${tool.name}`);
    assert.ok(["official", "openf1_enrichment", "forecast", "derived"].includes(tool.kind));
  }
});

// The proxy allow-list for /stints and /positions ships with the engine lot
// (H1). Until it lands, the browser tools answer 404 through the proxy (the
// MCP server and the bench read the API directly); once allowed, they are
// checked like every other tool.
const PROXY_PENDING = new Map([
  ["f1_stints", /^\/v1\/f1\/races\/\d{4}\/\d{1,2}\/stints$/],
  ["f1_positions", /^\/v1\/f1\/races\/\d{4}\/\d{1,2}\/positions$/],
]);

test("catalogue: every tool reads a GET path the proxy allows (no write tool)", () => {
  for (const tool of F1_TOOLS) {
    const input = tool.inputSchema.parse(SAMPLE_INPUT[tool.name]);
    const path = tool.path(input);
    assert.ok(path.startsWith("/v1/f1/"), path);
    const allowed = isAllowedProxyPath("GET", path.slice(1).split("/"));
    if (PROXY_PENDING.has(tool.name) && !allowed) assert.match(path, PROXY_PENDING.get(tool.name));
    else assert.equal(allowed, true, `${tool.name}: ${path}`);
    assert.equal(isAllowedProxyPath("POST", path.slice(1).split("/")), false);
    for (const related of Object.values(tool.related?.(input) ?? {})) {
      assert.equal(isAllowedProxyPath("GET", related.slice(1).split("/")), true, `${tool.name} companion: ${related}`);
    }
  }
});

test("catalogue: inputs export as closed JSON Schema objects (MCP-ready)", () => {
  const schemas = toolJsonSchemas();
  assert.equal(schemas.length, F1_TOOLS.length);
  for (const schema of schemas) {
    assert.equal(schema.inputSchema.type, "object", schema.name);
    assert.equal(schema.inputSchema.additionalProperties, false, schema.name);
  }
  const results = schemas.find((schema) => schema.name === "f1_race_results");
  assert.deepEqual(results.inputSchema.required.sort(), ["api_round", "season"]);
  assert.equal(results.inputSchema.properties.api_round.type, "integer");
});

test("catalogue: invalid input is refused before any request", async () => {
  let requests = 0;
  const runner = createF1ToolRunner({ fetchJson: async () => { requests += 1; return ok([]); } });
  for (const input of [{ season: 2026, api_round: "17" }, { season: 2026, api_round: 100 }, { season: 2026, api_round: 17, extra: 1 }, { season: 1900 }]) {
    const result = await runner.call(input.api_round === undefined ? "f1_calendar" : "f1_race_results", input);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /^Invalid input/);
  }
  assert.equal((await runner.call("f1_delete_everything", {})).ok, false);
  assert.equal(requests, 0);
});

test("catalogue: availability and reason pass through verbatim", async () => {
  const path = "/v1/f1/races/2026/17/fastest-laps";
  const runner = runnerFor({ [path]: ok({ availability: "unavailable", reason: "OpenF1 session not yet published", fastest_laps: [] }) });
  const result = await runner.call("f1_fastest_laps", { season: 2026, api_round: 17 });
  assert.equal(result.ok, true);
  assert.equal(result.availability, "unavailable");
  assert.equal(result.reason, "OpenF1 session not yet published");
  assert.deepEqual(result.data.fastest_laps, []);
});

test("catalogue: empty data and API errors are reported, never filled in", async () => {
  const runner = runnerFor({
    "/v1/f1/races/2026/18/weather": ok(null),
    "/v1/f1/races/2026/18/results": { status: 404, body: { status: "error", error: { code: 404, message: "Complete official race data is not available yet." } } },
  });
  const empty = await runner.call("f1_weather", { season: 2026, api_round: 18 });
  assert.equal(empty.ok, true);
  assert.equal(empty.empty, true);
  assert.equal(empty.data, null);
  const missing = await runner.call("f1_race_results", { season: 2026, api_round: 18 });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.error, { status: 404, message: "Complete official race data is not available yet." });
  assert.equal(missing.source.api_url, "https://api.thedatadriver.app/v1/f1/races/2026/18/results");
  const offline = await createF1ToolRunner({ fetchJson: async () => { throw new TypeError("Failed to fetch"); } }).call("f1_calendar", { season: 2026 });
  assert.equal(offline.ok, false);
  assert.equal(offline.error.message, "Failed to fetch");
});

test("catalogue: every result names its source, licence and public API URL", async () => {
  const runner = runnerFor(snapshot);
  const laps = await runner.call("f1_driver_laps", { season: 2026, api_round: 17, driver_id: 320 });
  assert.equal(laps.source.kind, "openf1_enrichment");
  assert.equal(laps.source.licence, "CC BY-NC-SA 4.0");
  assert.match(laps.source.attribution, /OpenF1/);
  assert.equal(laps.source.api_url, "https://api.thedatadriver.app/v1/f1/races/2026/17/laps/320");
  const results = await runner.call("f1_race_results", { season: 2026, api_round: 17 });
  assert.equal(results.source.kind, "official");
  assert.equal(results.source.licence, null);
  const forecast = await runner.call("f1_race_forecast", { season: 2026, api_round: 18 });
  assert.equal(forecast.source.kind, "forecast");
  const proxied = createF1ToolRunner({ fetchJson: createSnapshotFetcher(snapshot), publicOrigin: "https://example.test/" });
  assert.equal((await proxied.call("f1_calendar", { season: 2026 })).source.api_url, "https://example.test/v1/f1/calendar/2026");
});

test("catalogue: uncertified official_round values are dropped", async () => {
  const race = { round: 18, official_round: 16, name: "Fixture Grand Prix", date: "2026-10-11", status: "upcoming" };
  const uncertified = createF1ToolRunner({ fetchJson: createSnapshotFetcher({ "/v1/f1/calendar/2026": { status: 200, body: { status: "ok", data: [race], meta: { source: "tdd" } } } }) });
  assert.equal((await uncertified.call("f1_calendar", { season: 2026 })).data.races[0].official_round, null);
  const trusted = runnerFor({ "/v1/f1/calendar/2026": ok([race]) });
  assert.equal((await trusted.call("f1_calendar", { season: 2026 })).data.races[0].official_round, 16);
});

test("catalogue: outputs are bounded (row limits, lap window, character cap)", async () => {
  const runner = runnerFor(snapshot);
  const standings = await runner.call("f1_driver_standings", { season: 2026, limit: 3 });
  assert.equal(standings.data.standings.length, 3);
  assert.equal(standings.truncated.shown, 3);
  assert.ok(standings.truncated.total > 3);
  const laps = await runner.call("f1_driver_laps", { season: 2026, api_round: 17, driver_id: 320, from_lap: 1, to_lap: 99 });
  assert.equal(laps.data.laps.length, 20);
  for (const tool of F1_TOOLS) {
    const result = await runner.call(tool.name, SAMPLE_INPUT[tool.name]);
    assert.ok(JSON.stringify(result).length <= MAX_RESULT_CHARS, `${tool.name} exceeds the cap`);
  }
  assert.deepEqual(boundRows([1, 2, 3], 2), { rows: [1, 2], truncated: { shown: 2, total: 3 } });
  const big = { tool: "x", ok: true, data: { rows: Array.from({ length: 400 }, (_, index) => ({ index, text: "x".repeat(40) })) } };
  const fitted = fitResult(big, 2_000);
  assert.ok(JSON.stringify(fitted).length <= 2_000);
  assert.equal(fitted.truncated.total, 400);
});

// Review finding 4: the cap applies to the serialised result, one long text included.
test("catalogue: one long text field cannot exceed the cap", async () => {
  const runner = runnerFor({ "/v1/f1/races/2026/17/incidents": ok([{ type: "dnf", lap: 3, driver: "A B", description: "x".repeat(12_000) }], { source: "openf1" }) });
  const result = await runner.call("f1_incidents", { season: 2026, api_round: 17 });
  assert.ok(JSON.stringify(result).length <= MAX_RESULT_CHARS, `${JSON.stringify(result).length} characters`);
  const description = result.data.incidents[0].description;
  assert.ok(description.endsWith(TEXT_TRUNCATION_MARK));
  assert.ok(description.length <= MAX_TEXT_CHARS);
  assert.equal(result.truncated.text_fields, 1);
  assert.ok(result.truncated.original_chars > 12_000);
  assert.equal(result.source.licence, "CC BY-NC-SA 4.0", "provenance survives bounding");

  const many = Array.from({ length: 60 }, (_, index) => ({ type: "flag", lap: index, driver: "A B", description: "y".repeat(2_000) }));
  const bounded = await runnerFor({ "/v1/f1/races/2026/17/incidents": ok(many, { source: "openf1" }) }).call("f1_incidents", { season: 2026, api_round: 17, limit: 60 });
  assert.ok(JSON.stringify(bounded).length <= MAX_RESULT_CHARS);
  assert.equal(bounded.truncated.total, 60);
  assert.ok(bounded.truncated.shown < 60);

  const error = await runnerFor({ "/v1/f1/calendar/2026": { status: 502, body: { status: "error", error: { message: "z".repeat(20_000) } } } }).call("f1_calendar", { season: 2026 });
  assert.equal(error.ok, false);
  assert.ok(JSON.stringify(error).length <= MAX_RESULT_CHARS);
  assert.equal(error.error.message, "Upstream API unavailable.");

  const wide = { tool: "x", ok: true, data: { one: Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`k${index}`, `value ${index}`])) } };
  const squeezed = fitResult(wide, 1_000);
  assert.ok(JSON.stringify(squeezed).length <= 1_000);
  assert.equal(squeezed.data, null);
  assert.ok(squeezed.truncated.original_chars > 1_000);

  const small = { tool: "x", ok: true, data: { rows: [1, 2] } };
  assert.equal(fitResult(small), small, "a small result is returned untouched");
});

// Review finding 5: no silent list cut.
test("catalogue: safety cars and datasets report a cut list", async () => {
  const periods = Array.from({ length: 21 }, (_, index) => ({ type: "SC", start_lap: index + 1, end_lap: index + 2 }));
  const safety = await runnerFor({ "/v1/f1/races/2026/17/safety-cars": ok(periods, { source: "openf1" }) }).call("f1_safety_cars", { season: 2026, api_round: 17 });
  assert.equal(safety.data.periods.length, 20);
  assert.equal(safety.data.period_count, 21);
  assert.deepEqual(safety.truncated, { shown: 20, total: 21 });
  const datasets = Array.from({ length: 25 }, (_, index) => ({ dataset: `d${index}`, status: "ready" }));
  const status = await runnerFor({ "/v1/f1/races/2026/17/ingestion-readiness": ok({ ready: true, status: "ready", datasets }) }).call("f1_race_data_status", { season: 2026, api_round: 17 });
  assert.equal(status.data.datasets.length, 20);
  assert.deepEqual(status.truncated, { shown: 20, total: 25 });
  const few = await runnerFor({ "/v1/f1/races/2026/17/safety-cars": ok(periods.slice(0, 2), { source: "openf1" }) }).call("f1_safety_cars", { season: 2026, api_round: 17 });
  assert.equal(few.truncated, undefined);
});

// Lot H contract: 22 drivers, three stints each, positions from the grid to lap 57.
const openf1Meta = { source: "openf1.org", license: "CC BY-NC-SA 4.0", attribution: "Contains data from OpenF1 (https://openf1.org/).", data_fetched_at: "2026-10-05T16:00:00Z" };
const contractDrivers = Array.from({ length: 22 }, (_, index) => ({
  driver_id: 100 + index, driver_code: `D${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
  first_name: "Fixture", last_name: `Driver ${index + 1}`, team_name: "Fixture Team",
}));
const stintsPayload = {
  availability: "complete", reason: null, race_laps: 57,
  drivers: contractDrivers.map((driver) => ({
    ...driver,
    stints: [
      { stint_number: 1, compound: "MEDIUM", start_lap: 1, end_lap: 20, laps: 20, tyre_age_at_start: 0 },
      { stint_number: 2, compound: "HARD", start_lap: 21, end_lap: 40, laps: 20, tyre_age_at_start: 3 },
      { stint_number: 3, compound: "SOFT", start_lap: 41, end_lap: 57, laps: 17, tyre_age_at_start: 0 },
    ],
  })),
};
const positionsPayload = {
  availability: "partial", reason: "Lap 30 is missing for one driver.", method: "Order of lap completion from OpenF1 /position", race_laps: 57,
  drivers: contractDrivers.map((driver, index) => ({
    ...driver, grid: index + 1, finish: 22 - index,
    positions: Array.from({ length: 58 }, (_, lap) => ({ lap, position: lap === 0 ? index + 1 : lap < 30 ? index + 1 : 22 - index }))
      .filter((point) => !(index === 0 && point.lap === 30)),
  })),
};

test("catalogue: f1_stints is bounded, sourced and keeps the contract's fields", async () => {
  const runner = runnerFor({
    "/v1/f1/races/2026/17/stints": ok(stintsPayload, openf1Meta),
    "/v1/f1/races/2026/17/pitstops": ok([
      { stop: 1, lap: 20, duration_ms: 22_100, driver_code: "DAA" },
      { stop: 2, lap: 40, duration_ms: 21_900, driver_code: "DAA" },
      { stop: 1, lap: 20, duration_ms: 23_000, driver_code: "DAB" },
    ], { source: "formula1.com" }),
  });
  const result = await runner.call("f1_stints", { season: 2026, api_round: 17 });
  assert.equal(result.ok, true);
  assert.equal(result.availability, "complete");
  assert.equal(result.data.race_laps, 57);
  assert.equal(result.data.drivers.length, 10);
  assert.deepEqual(result.truncated, { shown: 10, total: 22 });
  assert.equal(result.data.drivers[0].sequence, "MEDIUM-HARD-SOFT");
  // Stint changes come from /stints; pit stops only from the official summary.
  assert.equal(result.data.drivers[0].stint_changes, 2);
  assert.equal(result.data.drivers[0].pit_stops, 2);
  assert.equal(result.data.drivers[1].stint_changes, 2);
  assert.equal(result.data.drivers[1].pit_stops, 1, "two stint changes, one official stop: never reported as two stops");
  assert.equal(result.data.drivers[2].pit_stops, 0);
  assert.equal("stops" in result.data.drivers[0], false);
  assert.equal(result.data.pit_stops_source, "formula1.com pit-stop summary (/pitstops)");
  assert.deepEqual(result.data.drivers[0].stints[1], { stint: 2, compound: "HARD", start_lap: 21, end_lap: 40, laps: 20, tyre_age_at_start: 3 });
  assert.equal(result.source.kind, "openf1_enrichment");
  assert.equal(result.source.licence, "CC BY-NC-SA 4.0");
  assert.equal(result.source.api_url, "https://api.thedatadriver.app/v1/f1/races/2026/17/stints");
  assert.ok(JSON.stringify(result).length <= MAX_RESULT_CHARS);
  const all = await runner.call("f1_stints", { season: 2026, api_round: 17, limit: 22 });
  assert.ok(JSON.stringify(all).length <= MAX_RESULT_CHARS);
  assert.ok(all.truncated, "a result cut to fit the cap says so");
  const one = await runner.call("f1_stints", { season: 2026, api_round: 17, driver_code: "dab" });
  assert.deepEqual(one.data.drivers.map((driver) => driver.code), ["DAB"]);
  assert.equal((await runner.call("f1_stints", { season: 2026, api_round: 17, limit: 40 })).ok, false);
});

test("catalogue: f1_positions summarises every driver and lists a bounded lap window", async () => {
  const runner = runnerFor({ "/v1/f1/races/2026/17/positions": ok(positionsPayload, openf1Meta) });
  const result = await runner.call("f1_positions", { season: 2026, api_round: 17 });
  assert.equal(result.ok, true);
  assert.equal(result.availability, "partial");
  assert.equal(result.reason, "Lap 30 is missing for one driver.");
  assert.equal(result.data.method, "Order of lap completion from OpenF1 /position");
  assert.equal(result.data.drivers.length, 22);
  const first = result.data.drivers[0];
  assert.deepEqual(
    { grid: first.grid, finish: first.finish, lap_1: first.lap_1, best: first.best_running, worst: first.worst_running, gained: first.places_gained, laps: first.laps_with_position },
    { grid: 1, finish: 22, lap_1: 1, best: 1, worst: 22, gained: -21, laps: 57 },
  );
  assert.equal(first.laps, undefined);
  assert.equal(first.gain_from_grid, -21);
  assert.equal(first.recovery_from_lowest_running_position, null, "a missing lap blocks a race recovery figure");
  assert.equal(result.data.drivers[1].gain_from_grid, -19);
  assert.equal(result.data.drivers[1].recovery_from_lowest_running_position, 0, "complete running positions support the separate recovery figure");
  assert.match(F1_TOOLS.find((tool) => tool.name === "f1_positions").description, /lowest position held during the race/);
  assert.equal(result.source.kind, "openf1_enrichment");
  assert.ok(JSON.stringify(result).length <= MAX_RESULT_CHARS);
  // A lap window needs a driver; it is capped at 20 laps and keeps gaps as gaps.
  const window = await runner.call("f1_positions", { season: 2026, api_round: 17, driver_code: "DAA", from_lap: 25, to_lap: 60 });
  const laps = window.data.drivers[0].laps;
  assert.equal(laps[0].lap, 25);
  assert.equal(laps.at(-1).lap, 44);
  assert.equal(laps.some((point) => point.lap === 30), false);
  assert.equal(laps.length, 19);
  const noDriver = await runner.call("f1_positions", { season: 2026, api_round: 17, from_lap: 0 });
  assert.equal(noDriver.data.drivers[0].laps, undefined);
});

test("catalogue: f1_stints and f1_positions report a missing endpoint and an unpublished race", async () => {
  const runner = runnerFor({
    "/v1/f1/races/2026/18/positions": ok({ availability: "unavailable", reason: "OpenF1 has not published this session yet.", method: null, race_laps: null, drivers: [] }, openf1Meta),
  });
  const missing = await runner.call("f1_stints", { season: 2026, api_round: 18 });
  assert.equal(missing.ok, false);
  // Stints published, pit-stop summary down: pit_stops stays null, never stint_changes.
  const noSummary = await runnerFor({
    "/v1/f1/races/2026/17/stints": ok({ ...stintsPayload, drivers: stintsPayload.drivers.slice(0, 1) }, openf1Meta),
  }).call("f1_stints", { season: 2026, api_round: 17 });
  assert.equal(noSummary.ok, true);
  assert.equal(noSummary.data.drivers[0].stint_changes, 2);
  assert.equal(noSummary.data.drivers[0].pit_stops, null);
  assert.match(noSummary.data.pit_stops_source, /^Official pit-stop summary unavailable \(HTTP 404\)/);
  assert.equal(missing.error.status, 404);
  assert.equal(missing.source.kind, "openf1_enrichment");
  assert.equal(missing.source.licence, "CC BY-NC-SA 4.0");
  const unpublished = await runner.call("f1_positions", { season: 2026, api_round: 18 });
  assert.equal(unpublished.ok, true);
  assert.equal(unpublished.availability, "unavailable");
  assert.equal(unpublished.reason, "OpenF1 has not published this session yet.");
  assert.deepEqual(unpublished.data.drivers, []);
});

test("catalogue: the browser fetcher calls only the same-origin proxy, with no credentials", async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ status: "ok", data: [], meta: certified }), { status: 200 });
  };
  try {
    const runner = createF1ToolRunner({ fetchJson: createProxyFetcher("/api/f1") });
    await runner.call("f1_calendar", { season: 2026 });
    await runner.call("f1_calendar", { season: 2026 });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(seen.length, 1, "repeated reads are served from the run cache");
  assert.equal(seen[0].url, "/api/f1/v1/f1/calendar/2026");
  assert.deepEqual(Object.keys(seen[0].init.headers), ["Accept"]);
  assert.equal(seen[0].init.method, undefined);
});

// ── Name resolution ────────────────────────────────────────────────────

const calendar2026 = snapshot["/v1/f1/calendar/2026"].body.data;
const standings2026 = snapshot["/v1/f1/standings/drivers/2026"].body.data;

test("resolve: races by demonym, city, official round and relative words", () => {
  assert.equal(matchRaces("Italian Grand Prix", calendar2026)[0].round, 15);
  assert.equal(matchRaces("Monza", calendar2026)[0].round, 15);
  assert.equal(matchRaces("Baku", calendar2026)[0].round, 17);
  assert.equal(matchRaces("Spanish Grand Prix", calendar2026)[0].circuit.city, "Madrid");
  assert.equal(matchRaces("Barcelona", calendar2026)[0].round, 9);
  assert.equal(matchRaces("round 16", calendar2026)[0].round, 25);
  assert.equal(matchRaces("latest", calendar2026)[0].status, "completed");
  assert.equal(matchRaces("next", calendar2026)[0].status, "upcoming");
  assert.deepEqual(matchRaces("Atlantis Grand Prix", calendar2026), []);
  assert.deepEqual(matchRaces("", calendar2026), []);
});

test("resolve: drivers by code, surname and full name; nothing invented", () => {
  assert.equal(matchDrivers("VER", standings2026)[0].last_name, "Verstappen");
  assert.equal(matchDrivers("antonelli", standings2026)[0].driver_code, "ANT");
  assert.equal(matchDrivers("George Russell", standings2026)[0].driver_code, "RUS");
  assert.deepEqual(matchDrivers("Ayrton Senna", standings2026), []);
});

// ── Providers and key storage ──────────────────────────────────────────

test("providers: base URLs that could send the key to The Data Driver are refused", () => {
  assert.equal(validateBaseURL("http://localhost:11434/v1").ok, true);
  assert.equal(validateBaseURL("http://127.0.0.1:11434/v1/").url, "http://127.0.0.1:11434/v1");
  assert.equal(validateBaseURL("https://llm.example.org/v1").ok, true);
  for (const bad of [
    "https://thedatadriver.app/api/f1",
    "https://api.thedatadriver.app/v1",
    "http://llm.example.org/v1",
    "https://user:secret@llm.example.org/v1",
    "https://llm.example.org/v1?key=1",
    "not a url",
  ]) assert.equal(validateBaseURL(bad).ok, false, bad);
  assert.equal(validateBaseURL("https://preview.example.app/v1", { pageOrigin: "https://preview.example.app" }).ok, false);
});

// Review finding 1: every spelling of a TDD host, and this machine under
// another name, must be refused before any request.
const BYPASSES = [
  "https://API.THEDATADRIVER.APP./v1",
  "https://api.thedatadriver.app./v1",
  "https://thedatadriver.app./v1",
  "https://thedatadriver.app../v1",
  "https://api%2ethedatadriver%2eapp/v1",
  "https://api.thedatadriver%2Eapp/v1",
  "https://api.thedatadriver\u3002app/v1",
  "https://api.thedatadriver\uff0eapp/v1",
  "https://\uff41\uff50\uff49.thedatadriver.app/v1",
  "https://ThEdAtAdRiVeR.aPp/v1",
  "https://api.thedatadriver.app:443/v1",
  "https://api.thedatadriver.app:8443/v1",
  "https://deep.sub.api.thedatadriver.app/v1",
  "https://user@api.thedatadriver.app/v1",
  "https://user:pw@llm.example.org@api.thedatadriver.app/v1",
  "https://thedatadriver.com/v1",
  "https://api.thedatadriver.com./v1",
  "https://203.0.113.10/v1",
  "https://[2001:db8::1]/v1",
  "http://example.org/v1",
  "http://localhost.evil.example/v1",
];

for (const url of BYPASSES) {
  test(`providers: refuses ${url}`, () => {
    assert.equal(validateBaseURL(url).ok, false, url);
    assert.equal(validateBaseURL(url, { pageOrigin: "https://thedatadriver.app" }).ok, false, url);
  });
}

for (const [url, pageOrigin] of [
  ["http://127.0.0.1:3000/v1", "http://localhost:3000"],
  ["http://localhost:3000/v1", "http://127.0.0.1:3000"],
  ["http://LOCALHOST.:3000/v1", "http://localhost:3000"],
  ["http://[::1]:3000/v1", "http://localhost:3000"],
  ["http://127.1:3000/v1", "http://localhost:3000"],
  ["http://0x7f.0.0.1:3000/v1", "http://localhost:3000"],
  ["https://PREVIEW.example.app./v1", "https://preview.example.app"],
  ["https://preview.example.app:8443/v1", "https://preview.example.app"],
]) {
  test(`providers: refuses ${url} from a page on ${pageOrigin}`, () => {
    assert.equal(validateBaseURL(url, { pageOrigin }).ok, false);
  });
}

test("providers: host normalisation and allowed local endpoints", () => {
  assert.equal(normaliseHost("API.THEDATADRIVER.APP."), "api.thedatadriver.app");
  assert.equal(normaliseHost("api%2ethedatadriver%2eapp"), "api.thedatadriver.app");
  assert.equal(normaliseHost("api.thedatadriver\u3002app"), "api.thedatadriver.app");
  assert.equal(normaliseHost("b\u00fccher.example"), "xn--bcher-kva.example");
  assert.equal(validateBaseURL("http://localhost:11434/v1", { pageOrigin: "http://localhost:3000" }).ok, true, "Ollama next to a local Lab");
  assert.equal(validateBaseURL("https://llm.example.org./v1").ok, true, "a trailing dot alone is not a TDD host");
  assert.equal(validateBaseURL("https://thedatadriver.app.example.org/v1").ok, true, "a lookalike under another domain is not TDD");
});

test("providers: the CSP connect list and the settings check agree", () => {
  assert.deepEqual(aiConnectOrigins(""), PROVIDER_CONNECT_ORIGINS);
  assert.deepEqual(parseConnectOrigins(" https://llm.example.org/v1  http://127.0.0.1:8080 "), ["https://llm.example.org", "http://127.0.0.1:8080"]);
  for (const bad of ["http://llm.example.org", "https://api.thedatadriver.app.", "https://u:p@llm.example.org", "nope"]) {
    assert.throws(() => parseConnectOrigins(bad), /NEXT_PUBLIC_TDD_AI_CONNECT_SRC/, bad);
  }
  const allowedOrigins = aiConnectOrigins("https://llm.example.org");
  assert.equal(checkSettings({ provider: "custom", model: "m", baseURL: "https://llm.example.org/v1" }, { allowedOrigins }).ok, true);
  const outside = checkSettings({ provider: "custom", model: "m", baseURL: "https://other.example.org/v1" }, { allowedOrigins });
  assert.equal(outside.ok, false);
  assert.match(outside.error, /open-source Data Lab/);
  assert.equal(checkSettings({ provider: "ollama", model: "qwen3" }, { allowedOrigins }).ok, true);
  assert.equal(checkSettings({ provider: "ollama", model: "qwen3", baseURL: "http://localhost:8080/v1" }, { allowedOrigins }).ok, false);
});

test("providers: settings need a model, and a key for hosted providers", () => {
  assert.equal(checkSettings({ provider: "anthropic", model: "claude-sonnet-5-5" }).ok, false);
  const anthropic = checkSettings({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-test", baseURL: "https://evil.example/v1" });
  assert.equal(anthropic.ok, true);
  assert.equal(anthropic.value.baseURL, PROVIDERS.anthropic.baseURL, "fixed providers ignore a typed base URL");
  assert.equal(checkSettings({ provider: "ollama", model: "qwen3" }).value.baseURL, "http://localhost:11434/v1");
  assert.equal(checkSettings({ provider: "custom", model: "m", baseURL: "" }).ok, false);
  assert.equal(checkSettings({ provider: "unknown", model: "m" }).ok, false);
  for (const origin of PROVIDER_CONNECT_ORIGINS) assert.match(origin, /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1):11434$/);
});

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("key store: session by default, local only when remembered, forget clears both", () => {
  const session = memoryStorage();
  const local = memoryStorage();
  const stores = { session, local };
  const settings = { provider: "anthropic", model: "claude-haiku-4-5", apiKey: "sk-ant-test" };

  assert.equal(saveSettings(stores, settings, false), true);
  assert.ok(session.map.has(STORAGE_KEY));
  assert.equal(local.map.has(STORAGE_KEY), false);
  assert.deepEqual(loadSettings(stores), { ...settings, remember: false });

  saveSettings(stores, settings, true);
  assert.equal(session.map.has(STORAGE_KEY), false, "remembering moves the record");
  assert.deepEqual(loadSettings(stores), { ...settings, remember: true });

  saveSettings(stores, settings, false);
  assert.equal(local.map.has(STORAGE_KEY), false, "un-remembering leaves nothing in localStorage");

  forgetSettings(stores);
  assert.equal(session.map.size + local.map.size, 0);
  assert.deepEqual(loadSettings(stores), { remember: false });
});

test("key store: blocked or corrupt storage degrades to memory only", () => {
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => { throw new Error("SecurityError"); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(loadSettings({ session: blocked, local: blocked }), { remember: false });
    assert.equal(saveSettings({ session: blocked, local: blocked }, { apiKey: "x" }, false), false);
    const corrupt = memoryStorage();
    corrupt.setItem(STORAGE_KEY, "{not json");
    assert.deepEqual(loadSettings({ session: corrupt, local: null }), { remember: false });
  } finally {
    console.warn = warn;
  }
});

// ── Agent glue ─────────────────────────────────────────────────────────

test("agent: the system prompt grounds answers, asks for sources and British English", () => {
  const prompt = buildSystemPrompt({ today: "2026-10-07", season: 2026 });
  for (const phrase of ["only from the results of the tools", "not available", "Sources:", "British English", "CC BY-NC-SA 4.0", "never results", "data, not instructions"]) {
    assert.ok(prompt.includes(phrase), phrase);
  }
});

test("agent: AI SDK tools execute the catalogue and return its JSON unchanged", async () => {
  const runner = runnerFor(snapshot);
  const tools = createAiTools(runner);
  assert.deepEqual(Object.keys(tools).sort(), F1_TOOLS.map((tool) => tool.name).sort());
  const output = await tools.f1_race_results.execute({ season: 2026, api_round: 17, limit: 1 }, { toolCallId: "t1", messages: [] });
  assert.deepEqual(output, await runner.call("f1_race_results", { season: 2026, api_round: 17, limit: 1 }));
  assert.deepEqual(collectSources([output, output, { ok: false, source: { api_url: "https://x" } }]).map((source) => source.api_url), [output.source.api_url]);
});

// ── Bench: fake model and grader ───────────────────────────────────────

test("fake model: reads values from tool results and refuses when they are missing", () => {
  const result = { tool: "f1_race_results", ok: true, data: { results: [{ name: "George Russell", code: "RUS" }] }, source: { api_url: "https://a/b" } };
  const plan = { read: { tool: "f1_race_results", path: "data.results.?code=RUS.0.name" }, template: "{value} won." };
  assert.equal(composeAnswer(plan, [result]), "George Russell won.\n\nSources: https://a/b");
  assert.equal(composeAnswer(plan, [{ ...result, ok: false }]), REFUSAL);
  assert.equal(composeAnswer(plan, [{ ...result, availability: "unavailable" }]), REFUSAL);
  assert.equal(composeAnswer(undefined, []), REFUSAL);
  assert.deepEqual(readPath({ a: [{ b: 1 }, { b: 2 }] }, "a.*.b"), [1, 2]);
  const structured = composeAnswer(plan, [result], { structured: true });
  assert.deepEqual(extractStructured(structured).block, { answer_value: "George Russell", refused: false });
  assert.deepEqual(extractStructured(composeAnswer(plan, [], { structured: true })).block, { answer_value: null, refused: true });
  assert.match(buildSystemPrompt({ today: "2026-10-07", season: 2026, extraRules: [STRUCTURED_ANSWER_RULE] }), /9\. Finish your reply with a fenced JSON block/);
});

test("grader: exact, refusals and wrong answers", () => {
  assert.equal(containsValue("Round 15 of the season", "15"), true);
  assert.equal(containsValue("Round 15 of the season", "5"), false);
  assert.equal(containsValue("He scored 236.0 points", "236"), false);
  assert.equal(containsValue("Nico Hülkenberg", "Nico Hulkenberg"), true);
  assert.equal(isRefusal("That is not available in The Data Driver data."), true);
  assert.equal(isRefusal("George Russell won."), false);
  const item = { kind: "answer", expect: ["George Russell", ["P2", "second"]] };
  assert.equal(gradeAnswer(item, "George Russell was second.").grade, "exact");
  assert.equal(gradeAnswer(item, "Max Verstappen was P2.").grade, "wrong");
  assert.equal(gradeAnswer(item, "That is not available.").grade, "unnecessary_refusal");
  assert.equal(gradeAnswer(item, null).grade, "error");
  const refusal = { kind: "refusal", expect: [], forbid: ["Lando Norris"] };
  assert.equal(gradeAnswer(refusal, "Not available in the data.").grade, "correct_refusal");
  assert.equal(gradeAnswer(refusal, "Lando Norris won it.").grade, "wrong");
  assert.equal(gradeAnswer(refusal, "Not available, but Lando Norris probably won.").grade, "wrong");
  assert.equal(summarise([{ grade: "exact" }, { grade: "wrong" }]).passed, false);
  assert.equal(summarise([{ grade: "exact" }, { grade: "correct_refusal" }]).score, 100);
});

// Review finding 3: the grader checks meaning, not substrings.
const leader = { kind: "answer", expect: ["Kimi Antonelli"] };
const block = (value, refused = false) => `\n\n\`\`\`json\n${JSON.stringify({ answer_value: value, refused })}\n\`\`\``;

test("grader (prose): a negated expected value is wrong, not exact", () => {
  assert.equal(gradeAnswer(leader, "Kimi Antonelli is not the leader; Max Verstappen is.").grade, "wrong");
  assert.deepEqual(gradeAnswer(leader, "Kimi Antonelli is not the leader; Max Verstappen is.").negated, ["Kimi Antonelli"]);
  assert.equal(gradeAnswer(leader, "Kimi Antonelli isn't leading the championship.").grade, "wrong");
  assert.equal(gradeAnswer(leader, "It's not Max Verstappen: Kimi Antonelli leads.").grade, "exact");
  assert.equal(gradeAnswer(leader, "Kimi Antonelli leads, not Max Verstappen.").grade, "exact");
  assert.equal(gradeAnswer(leader, "Kimi Antonelli leads the championship.").grade, "exact");
  assert.equal(valueStance("Lando Norris did not win, but Oscar Piastri did.", "Oscar Piastri"), "asserted");
  assert.equal(valueStance("Lando Norris did not win.", "Lando Norris"), "negated");
  assert.equal(valueStance("Nothing here.", "Lando Norris"), "absent");
});

test("grader (structured): values are compared one by one, never as substrings", () => {
  const opts = { format: "structured" };
  assert.equal(gradeAnswer(leader, `Kimi Antonelli leads.${block("Kimi Antonelli")}`, opts).grade, "exact");
  assert.equal(gradeAnswer(leader, `Kimi Antonelli is not the leader; Max Verstappen is.${block("Max Verstappen")}`, opts).grade, "wrong");
  assert.equal(gradeAnswer(leader, `Kimi Antonelli is not the leader.${block("Kimi Antonelli")}`, opts).grade, "wrong", "prose contradicting the block");
  assert.equal(gradeAnswer(leader, `Kimi Antonelli and Max Verstappen.${block("Max Verstappen, Kimi Antonelli")}`, opts).grade, "wrong", "a list in one string is not the value");
  assert.equal(gradeAnswer(leader, "Kimi Antonelli leads.", opts).grade, "wrong", "no block");
  assert.equal(gradeAnswer(leader, `Kimi Antonelli leads.\n\`\`\`json\n{"answer_value": "Kimi Antonelli"}\n\`\`\``, opts).grade, "wrong", "malformed block");
  assert.equal(gradeAnswer(leader, `Not available.${block(null, true)}`, opts).grade, "unnecessary_refusal");
  assert.equal(gradeAnswer(leader, `Not available.${block("Kimi Antonelli", true)}`, opts).grade, "wrong");
  const second = { kind: "answer", expect: ["George Russell", "5"] };
  assert.equal(gradeAnswer(second, `x${block(["George Russell", 5])}`, opts).grade, "exact");
  assert.equal(gradeAnswer(second, `x${block(["George Russell", 15])}`, opts).grade, "wrong");
  const refusal = { kind: "refusal", expect: [], forbid: ["Lando Norris"] };
  assert.equal(gradeAnswer(refusal, `That is not available.${block(null, true)}`, opts).grade, "correct_refusal");
  assert.equal(gradeAnswer(refusal, `Lando Norris won.${block("Lando Norris")}`, opts).grade, "wrong");
  assert.equal(gradeAnswer(refusal, `Not available, but Lando Norris won.${block(null, true)}`, opts).grade, "wrong", "forbidden in the prose");
  assert.equal(valueMatches("P2", 2), true);
  assert.equal(valueMatches("9th", "P9"), true);
  assert.equal(valueMatches("357", "357 points"), true);
  assert.equal(valueMatches("23.4%", 23.4), true);
  assert.equal(valueMatches("357", "3570"), false);
  assert.equal(valueMatches("Norris", "Lando Norris"), true);
  assert.equal(valueMatches("Norris", "Not Norris"), false);
  assert.equal(valueMatches("Norris", "Lando Norris is not it"), false);
  assert.equal(valueMatches("11 October", "11 October 2026"), true);
});

test("grader: refusals and a missed threshold cannot pass a run", () => {
  const answer = (grade) => ({ kind: "answer", grade });
  // The review's reproduction: one answerable question refused → was PASS at 0 %.
  assert.equal(summarise([answer("unnecessary_refusal")]).passed, false);
  const allRefused = Array.from({ length: 10 }, () => answer("unnecessary_refusal"));
  assert.equal(summarise(allRefused).passed, false);
  const nineOfTen = [...Array.from({ length: 9 }, () => answer("exact")), answer("unnecessary_refusal")];
  assert.equal(summarise(nineOfTen).passed, true);
  assert.equal(summarise(nineOfTen, { minExact: 0.95 }).passed, false);
  const eightOfTen = [...Array.from({ length: 8 }, () => answer("exact")), answer("unnecessary_refusal"), answer("unnecessary_refusal")];
  assert.equal(summarise(eightOfTen).passed, false);
  assert.equal(summarise([...nineOfTen.slice(0, 9), answer("wrong")], { minExact: 0 }).passed, false, "one wrong answer fails whatever the threshold");
  assert.equal(summarise([...nineOfTen, { kind: "refusal", grade: "correct_refusal" }]).answerable, 10);
});

test("bench: about fifty frozen questions, every answerable one with expected values and a source", () => {
  assert.ok(truth.questions.length >= 45, `${truth.questions.length} questions`);
  assert.match(truth.frozen_at, /^\d{4}-\d{2}-\d{2}T/);
  const ids = truth.questions.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of truth.questions) {
    if (item.kind === "answer") {
      assert.ok(item.expect.length > 0, item.id);
      assert.ok(item.sources.length > 0, item.id);
      for (const source of item.sources) assert.ok(snapshot[source.replace("https://api.thedatadriver.app", "")], `${item.id}: ${source} not frozen`);
    }
  }
  assert.ok(truth.questions.filter((item) => item.kind === "refusal").length >= 8);
});
