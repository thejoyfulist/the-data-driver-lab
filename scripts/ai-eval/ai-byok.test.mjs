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
  toolJsonSchemas,
} from "../../src/lib/f1-tools/catalogue.mjs";
import { matchDrivers, matchRaces } from "../../src/lib/f1-tools/resolve.mjs";
import { isAllowedProxyPath } from "../../src/lib/proxy-allowlist.mjs";
import { checkSettings, PROVIDER_CONNECT_ORIGINS, PROVIDERS, validateBaseURL } from "../../src/lib/ai-byok/providers.mjs";
import { forgetSettings, loadSettings, saveSettings, STORAGE_KEY } from "../../src/lib/ai-byok/key-store.mjs";
import { buildSystemPrompt, collectSources, createAiTools } from "../../src/lib/ai-byok/agent.mjs";
import { composeAnswer, readPath, REFUSAL } from "./fake-openai.mjs";
import { containsValue, gradeAnswer, isRefusal, summarise } from "./grade.mjs";

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

test("catalogue: every tool reads a GET path the proxy allows (no write tool)", () => {
  for (const tool of F1_TOOLS) {
    const input = tool.inputSchema.parse(SAMPLE_INPUT[tool.name]);
    const path = tool.path(input);
    assert.ok(path.startsWith("/v1/f1/"), path);
    assert.equal(isAllowedProxyPath("GET", path.slice(1).split("/")), true, `${tool.name}: ${path}`);
    assert.equal(isAllowedProxyPath("POST", path.slice(1).split("/")), false);
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
