#!/usr/bin/env node
/**
 * Fake OpenAI-compatible chat endpoint for tests and the bench's mock mode.
 * No model, no network, no key check beyond recording what it received.
 *
 * It plays a fixed "plan" per question: tool calls step by step, then one
 * answer that reads a value from the TOOL RESULTS it was sent back. When a
 * tool result is an error, empty, not "completed", or lacks the value, it
 * answers that the data is not available. Unknown questions get the same
 * refusal. Answers stream as SSE chunks like the real API.
 *
 * Plan: { steps: [[{ name, arguments }], ...], read: { tool, path, fields?, count? }, template }
 * Path: dot segments; "*" maps an array, "?key=value" filters one.
 *
 * Run standalone: node scripts/ai-eval/fake-openai.mjs [port] (plans from e2e/ai-plans.json if present)
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REFUSAL = "That is not available in The Data Driver data.";

export function readPath(value, path) {
  let current = value;
  for (const segment of path.split(".")) {
    if (current == null) return undefined;
    if (segment === "*") {
      if (!Array.isArray(current)) return undefined;
      continue;
    }
    if (segment.startsWith("?")) {
      const [key, wanted] = segment.slice(1).split("=");
      if (!Array.isArray(current)) return undefined;
      current = current.filter((row) => String(row?.[key]) === wanted);
      continue;
    }
    current = Array.isArray(current) && !/^\d+$/.test(segment) ? current.map((row) => row?.[segment]) : current[segment];
  }
  return current;
}

/** Usable tool result, or null when the model must refuse. */
function usable(result) {
  if (!result || result.ok !== true || result.empty) return null;
  if (result.availability && result.availability !== "completed") return null;
  return result;
}

/**
 * Answer text for a plan given the tool results returned so far.
 * @param {Record<string, any> | undefined} plan
 * @param {Array<Record<string, any>>} results tool results (parsed JSON), in call order
 */
export function composeAnswer(plan, results) {
  if (!plan?.read) return REFUSAL;
  const result = usable([...results].reverse().find((entry) => entry?.tool === plan.read.tool));
  if (!result) return REFUSAL;
  let value = readPath(result, plan.read.path);
  if (plan.read.count) value = Array.isArray(value) ? value.length : undefined;
  if (plan.read.fields && value && typeof value === "object") value = plan.read.fields.map((field) => value[field]).join(", ");
  if (Array.isArray(value)) value = value.filter((entry) => entry != null).join(", ");
  if (value == null || value === "") return REFUSAL;
  const sources = [...new Set(results.map((entry) => entry?.source?.api_url).filter(Boolean))];
  return `${plan.template.replace("{value}", String(value))}\n\nSources: ${sources.join(" ")}`;
}

function lastUserText(messages) {
  const user = [...messages].reverse().find((message) => message.role === "user");
  if (!user) return "";
  if (typeof user.content === "string") return user.content;
  return (Array.isArray(user.content) ? user.content : []).map((part) => part?.text ?? "").join("");
}

/** Messages after the last user turn: how many tool steps already ran, and their results. */
function progress(messages) {
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  const after = messages.slice(lastUser + 1);
  const stepsDone = after.filter((message) => message.role === "assistant" && message.tool_calls?.length).length;
  const results = after.filter((message) => message.role === "tool").map((message) => {
    try {
      return JSON.parse(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
    } catch (error) {
      return { ok: false, error: { message: `unparsable tool result (${error instanceof Error ? error.name : "error"})` } };
    }
  });
  return { stepsDone, results };
}

function sse(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end("data: [DONE]\n\n");
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-title, http-referer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * @param {{ plans: Record<string, any>, match?: (question: string, plans: Record<string, any>) => any }} options
 */
export function createFakeOpenAIServer({ plans, match }) {
  const requests = [];
  const findPlan = match ?? ((question) => plans[question.trim()]);
  let counter = 0;

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify(requests));
      return;
    }
    if (req.method === "POST" && req.url === "/__reset") {
      requests.length = 0;
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: { message: `Invalid JSON (${error instanceof Error ? error.name : "error"})` } }));
        return;
      }
      requests.push({ path: req.url, authorization: req.headers.authorization ?? null, origin: req.headers.origin ?? null, model: body.model, tools: (body.tools ?? []).map((entry) => entry.function?.name) });
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const plan = findPlan(lastUserText(messages), plans);
      const { stepsDone, results } = progress(messages);
      const id = `chatcmpl-fake-${counter += 1}`;
      const base = { id, object: "chat.completion.chunk", created: 1_760_000_000, model: body.model ?? "fake" };
      const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
      const nextStep = plan?.steps?.[stepsDone];

      if (nextStep?.length) {
        const toolCalls = nextStep.map((call, index) => ({ index, id: `call_${stepsDone}_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
        if (body.stream === false) {
          res.writeHead(200, { "Content-Type": "application/json", ...CORS });
          res.end(JSON.stringify({ id, object: "chat.completion", created: base.created, model: base.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: toolCalls.map(({ index: _index, ...call }) => call) }, finish_reason: "tool_calls" }], usage }));
          return;
        }
        sse(res, [
          { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: toolCalls }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage },
        ]);
        return;
      }

      const answer = composeAnswer(plan, results);
      if (body.stream === false) {
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ id, object: "chat.completion", created: base.created, model: base.model, choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }], usage }));
        return;
      }
      const pieces = answer.match(/.{1,24}/gs) ?? [answer];
      sse(res, [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
        ...pieces.map((piece) => ({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })),
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
      ]);
    });
  });
  return { server, requests };
}

// Standalone (Playwright webServer): plans from e2e/ai-plans.json, matched by substring.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.argv[2] ?? process.env.TDD_FAKE_LLM_PORT ?? "4012", 10);
  const plansFile = new URL("../../e2e/ai-plans.json", import.meta.url);
  const plans = existsSync(plansFile) ? JSON.parse(readFileSync(plansFile, "utf8")) : {};
  const { server } = createFakeOpenAIServer({
    plans,
    match: (question, all) => Object.entries(all).find(([key]) => question.toLowerCase().includes(key.toLowerCase()))?.[1],
  });
  server.listen(port, "127.0.0.1", () => console.log(`Fake OpenAI-compatible endpoint on http://127.0.0.1:${port}/v1`));
}
