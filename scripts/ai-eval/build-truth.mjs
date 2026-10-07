#!/usr/bin/env node
/**
 * Freeze the evaluation truth from the public API (read-only GETs).
 *
 *   node scripts/ai-eval/build-truth.mjs [--api https://api.thedatadriver.app]
 *
 * Writes truth.json (questions, expected values computed from the RAW API
 * responses, date) and api-snapshot.json (every response the questions and
 * the mock plans read, so the mock run needs no network).
 */

import { writeFileSync } from "node:fs";
import { F1_TOOLS, DEFAULT_PUBLIC_API_ORIGIN } from "../../src/lib/f1-tools/catalogue.mjs";
import { SPECS } from "./question-specs.mjs";

const args = process.argv.slice(2);
const apiIndex = args.indexOf("--api");
const apiBase = (apiIndex >= 0 ? args[apiIndex + 1] : DEFAULT_PUBLIC_API_ORIGIN).replace(/\/+$/, "");
const here = new URL(".", import.meta.url);
const toolByName = new Map(F1_TOOLS.map((tool) => [tool.name, tool]));

const paths = new Set();
for (const spec of SPECS) {
  for (const path of spec.sources) paths.add(path);
  for (const step of spec.mock.steps ?? []) {
    for (const call of step) {
      const tool = toolByName.get(call.name);
      if (!tool) throw new Error(`${spec.id}: unknown tool ${call.name}`);
      paths.add(tool.path(call.arguments));
      for (const path of Object.values(tool.related?.(call.arguments) ?? {})) paths.add(path);
    }
  }
}

const snapshot = {};
for (const path of [...paths].sort()) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  snapshot[path] = { status: response.status, body: await response.json() };
  await new Promise((resolve) => setTimeout(resolve, 150));
}

const get = (path) => {
  const entry = snapshot[path];
  if (!entry || entry.status !== 200 || entry.body?.status === "error") throw new Error(`Truth source unavailable: ${path} (${entry?.status})`);
  return entry.body;
};

const questions = SPECS.map((spec) => {
  const expect = spec.truth({ get });
  if (spec.kind === "answer" && (!Array.isArray(expect) || expect.length === 0)) throw new Error(`${spec.id}: no expected value`);
  return {
    id: spec.id,
    category: spec.category,
    kind: spec.kind,
    question: spec.question,
    expect,
    forbid: spec.forbid ?? [],
    sources: spec.sources.map((path) => `${DEFAULT_PUBLIC_API_ORIGIN}${path}`),
    mock: spec.mock,
  };
});

const frozenAt = new Date().toISOString();
writeFileSync(new URL("truth.json", here), `${JSON.stringify({ frozen_at: frozenAt, api_base: apiBase, count: questions.length, questions }, null, 2)}\n`);
writeFileSync(new URL("api-snapshot.json", here), `${JSON.stringify({ frozen_at: frozenAt, api_base: apiBase, responses: snapshot })}\n`);
console.log(`Froze ${questions.length} questions and ${Object.keys(snapshot).length} API responses (${frozenAt}).`);
