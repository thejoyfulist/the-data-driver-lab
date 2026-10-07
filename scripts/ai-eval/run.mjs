#!/usr/bin/env node
/**
 * Evaluation bench for "Ask the data".
 *
 *   node scripts/ai-eval/run.mjs --mode mock
 *       Fake OpenAI-compatible model (fake-openai.mjs) + frozen API snapshot.
 *       No network, no key: this is the CI run. It exercises the real AI SDK
 *       loop, the tool catalogue and the grader.
 *   node scripts/ai-eval/run.mjs --mode deterministic [--api URL]
 *       The default grounded endpoint (POST /v1/f1/chat), no AI.
 *   TDD_EVAL_API_KEY=… node scripts/ai-eval/run.mjs --mode provider --provider ollama --model qwen3
 *       A real model. Tools read the frozen snapshot by default (--tools live
 *       to read the public API). Paid providers need --allow-paid: running
 *       one costs money on the key's account.
 *
 * Options: --only id,id  --limit N  --out DIR  --base-url URL (ollama/custom)
 *          --delay MS (deterministic mode, pause between questions, default 1500)
 * The deterministic endpoint is rate limited: the run stops at the first
 * HTTP 429 and marks the remaining questions "not run" instead of retrying.
 * Writes <out>/<mode>[-provider-model].json and .md. Exit code 1 when any
 * answer is wrong or a call failed.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createF1ToolRunner, createHttpFetcher, createSnapshotFetcher, DEFAULT_PUBLIC_API_ORIGIN } from "../../src/lib/f1-tools/catalogue.mjs";
import { checkSettings, PROVIDERS } from "../../src/lib/ai-byok/providers.mjs";
import { collectSources, createLanguageModel, streamGroundedAnswer } from "../../src/lib/ai-byok/agent.mjs";
import { createFakeOpenAIServer } from "./fake-openai.mjs";
import { gradeAnswer, summarise } from "./grade.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const PAID = new Set(["anthropic", "openai", "openrouter", "groq"]);

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const mode = option("mode", "mock");
const truth = JSON.parse(readFileSync(resolve(here, "truth.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(resolve(here, "api-snapshot.json"), "utf8"));
const only = option("only")?.split(",").map((id) => id.trim()).filter(Boolean);
const limit = Number.parseInt(option("limit", "0"), 10) || null;
let questions = truth.questions.filter((item) => !only || only.includes(item.id));
if (limit) questions = questions.slice(0, limit);
const today = truth.frozen_at.slice(0, 10);
const season = Number(today.slice(0, 4));
const outDir = resolve(option("out", resolve(here, "results")));

async function askModel(model, fetcher, question) {
  const runner = createF1ToolRunner({ fetchJson: fetcher });
  const calls = [];
  const toolResults = [];
  let text = "";
  const result = streamGroundedAnswer({ model, runner, question, today, season, abortSignal: AbortSignal.timeout(120_000) });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
    else if (part.type === "tool-call") calls.push({ tool: part.toolName, input: part.input });
    else if (part.type === "tool-result") toolResults.push(part.output);
    else if (part.type === "tool-error") toolResults.push({ ok: false, error: { message: String(part.error) } });
    else if (part.type === "error") throw part.error instanceof Error ? part.error : new Error(String(part.error));
  }
  return { answer: text.trim(), calls, sources: collectSources(toolResults).map((source) => source.api_url) };
}

async function askDeterministic(apiBase, question) {
  const response = await fetch(`${apiBase}/v1/f1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ message: question }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch((error) => ({ status: "error", error: { message: `non-JSON response (${error.name})` } }));
  if (!response.ok || body?.status === "error") throw new Error(`HTTP ${response.status}: ${body?.error?.message ?? "error"}`);
  const data = body?.data ?? body;
  return { answer: String(data?.answer ?? "").trim(), calls: [], sources: (Array.isArray(data?.sources) ? data.sources : []).map((source) => source?.href ?? source?.title).filter(Boolean) };
}

async function main() {
  let ask;
  let label;
  let fake;
  if (mode === "mock") {
    const plans = Object.fromEntries(truth.questions.map((item) => [item.question, item.mock]));
    fake = createFakeOpenAIServer({ plans });
    await new Promise((done) => fake.server.listen(0, "127.0.0.1", done));
    const { port } = fake.server.address();
    const model = createLanguageModel({ provider: "custom", model: "fake-grounded", baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "mock-key-not-secret" });
    const fetcher = createSnapshotFetcher(snapshot.responses);
    ask = (question) => askModel(model, fetcher, question);
    label = "mock";
  } else if (mode === "deterministic") {
    const apiBase = option("api", DEFAULT_PUBLIC_API_ORIGIN).replace(/\/+$/, "");
    ask = async (question) => {
      const answer = await askDeterministic(apiBase, question);
      await new Promise((done) => setTimeout(done, Number.parseInt(option("delay", "1500"), 10)));
      return answer;
    };
    label = "deterministic";
  } else if (mode === "provider") {
    const provider = option("provider");
    if (!PROVIDERS[provider]) throw new Error(`--provider must be one of ${Object.keys(PROVIDERS).join(", ")}`);
    if (PAID.has(provider) && !flag("allow-paid")) throw new Error(`${provider} is a paid API: add --allow-paid to run it on your own key.`);
    const checked = checkSettings({ provider, model: option("model"), baseURL: option("base-url") ?? undefined, apiKey: process.env.TDD_EVAL_API_KEY ?? "" });
    if (!checked.ok) throw new Error(checked.error);
    const model = createLanguageModel(checked.value);
    const fetcher = option("tools", "snapshot") === "live" ? createHttpFetcher(DEFAULT_PUBLIC_API_ORIGIN) : createSnapshotFetcher(snapshot.responses);
    ask = (question) => askModel(model, fetcher, question);
    label = `provider-${provider}-${checked.value.model.replace(/[^a-z0-9.-]+/gi, "_")}`;
  } else {
    throw new Error("--mode must be mock, deterministic or provider");
  }

  const rows = [];
  let stoppedBy = null;
  for (const item of questions) {
    let outcome;
    if (stoppedBy) {
      outcome = { answer: null, calls: [], sources: [], error: `not run: ${stoppedBy}` };
    } else {
      try {
        outcome = await ask(item.question);
      } catch (error) {
        outcome = { answer: null, calls: [], sources: [], error: error instanceof Error ? error.message : String(error) };
        if (mode === "deterministic" && /^HTTP 429/.test(outcome.error)) stoppedBy = outcome.error;
      }
    }
    const graded = gradeAnswer(item, outcome.answer);
    rows.push({ id: item.id, category: item.category, kind: item.kind, question: item.question, grade: graded.grade, missing: graded.missing, forbidden: graded.forbidden, answer: outcome.answer, error: outcome.error ?? null, tool_calls: outcome.calls, sources: outcome.sources });
  }
  fake?.server.close();

  const summary = summarise(rows);
  const report = { mode, label, ran_at: new Date().toISOString(), truth_frozen_at: truth.frozen_at, summary, rows };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(outDir, `${label}.md`), toMarkdown(report));
  console.log(`${label}: ${summary.total} questions — exact ${summary.exact}, correct refusals ${summary.correct_refusal}, unnecessary refusals ${summary.unnecessary_refusal}, wrong ${summary.wrong}, errors ${summary.error} — score ${summary.score}% — ${summary.passed ? "PASS" : "FAIL"}`);
  if (!summary.passed) process.exitCode = 1;
}

function toMarkdown({ label, ran_at, truth_frozen_at, summary, rows }) {
  const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);
  return [
    `# Ask the data — evaluation (${label})`,
    "",
    `Run ${ran_at}; truth frozen ${truth_frozen_at}.`,
    "",
    "| Total | Exact | Correct refusals | Unnecessary refusals | Wrong | Errors | Score | Verdict |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    `| ${summary.total} | ${summary.exact} | ${summary.correct_refusal} | ${summary.unnecessary_refusal} | ${summary.wrong} | ${summary.error} | ${summary.score}% | ${summary.passed ? "PASS" : "FAIL"} |`,
    "",
    "| Id | Grade | Tools | Answer / error | Missing |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.id} | ${row.grade} | ${row.tool_calls.map((call) => call.tool).join(", ")} | ${cell(row.error ?? row.answer)} | ${cell(row.missing.join("; "))} |`),
    "",
  ].join("\n");
}

await main();
