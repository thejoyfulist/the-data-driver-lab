"use client";

/**
 * "Ask the data — AI, your own key". Loaded on demand (next/dynamic) when
 * the visitor picks the AI mode, so the AI SDK never weighs on the default
 * Lab. The browser calls the chosen provider directly with the visitor's
 * key; F1 tools run here too, through the same-origin read-only proxy, which
 * never sees the key.
 */

import { useId, useMemo, useRef, useState } from "react";
import { collectSources, createLanguageModel, MAX_TOOL_STEPS, streamGroundedAnswer, type AnswerSource } from "@/lib/ai-byok/agent.mjs";
import { browserStores, forgetSettings, loadSettings, saveSettings } from "@/lib/ai-byok/key-store.mjs";
import { aiConnectOrigins, checkSettings, isProviderId, PROVIDER_IDS, PROVIDERS, type AiSettings, type ProviderId } from "@/lib/ai-byok/providers.mjs";
import { createF1ToolRunner, createProxyFetcher, type F1ToolResult } from "@/lib/f1-tools/catalogue.mjs";
import { LAB_PROXY_BASE, PUBLIC_API_ORIGIN } from "@/lib/lab-client";

interface ToolCallView {
  id: string;
  tool: string;
  input: unknown;
  output?: F1ToolResult;
  failed?: string;
}

type RunState = "idle" | "running" | "done" | "error";

/** Abort reason of a run cancelled by "Forget key". */
const KEY_FORGOTTEN = "key-forgotten";

const buttonClass =
  "min-h-11 rounded-lg px-4 text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 disabled:cursor-not-allowed disabled:opacity-40";

/** One-line summary of a tool call's input ("season 2026 · api_round 17"). */
function describeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  return Object.entries(input as Record<string, unknown>).map(([key, value]) => `${key} ${String(value)}`).join(" · ");
}

function describeOutcome(call: ToolCallView): string {
  if (call.failed) return "failed";
  const output = call.output;
  if (!output) return "running…";
  if (!output.ok) return output.error?.message ?? "not available";
  if (output.empty) return "no data published";
  if (output.availability && output.availability !== "completed") return `availability: ${output.availability}`;
  const cut = output.truncated;
  if (!cut) return "ok";
  return cut.total != null ? `ok · ${cut.shown} of ${cut.total} rows` : "ok · long text shortened";
}

/** Provider error for display; the key is never echoed back. */
function describeError(error: unknown, apiKey: string): string {
  const record = error as { statusCode?: number; message?: string; name?: string } | null;
  let message: string;
  if (record?.statusCode === 401 || record?.statusCode === 403) message = `The provider rejected the key (HTTP ${record.statusCode}).`;
  else if (record?.statusCode === 404) message = "The provider does not know this model or URL (HTTP 404).";
  else if (record?.statusCode === 429) message = "The provider's rate limit was reached (HTTP 429). Try again later.";
  else if (record?.name === "AbortError" || record?.name === "TimeoutError") message = "The request was stopped.";
  else if (error instanceof TypeError) message = "The provider could not be reached from this browser (network or CORS). Local servers must allow this site's origin.";
  else message = record?.message ? `Provider error: ${record.message}` : "The provider returned an error.";
  return apiKey ? message.split(apiKey).join("[key]") : message;
}

export default function AskAiPanel({ season }: { season: number }) {
  const formId = useId();
  const stores = useMemo(() => browserStores(), []);
  const [initial] = useState(() => loadSettings(stores));
  const [provider, setProvider] = useState<ProviderId>(isProviderId(initial.provider) ? initial.provider : "anthropic");
  const [model, setModel] = useState(initial.model ?? PROVIDERS.anthropic.models[0]);
  const [baseURL, setBaseURL] = useState(initial.baseURL ?? "");
  const [apiKey, setApiKey] = useState(initial.apiKey ?? "");
  const [remember, setRemember] = useState(initial.remember);
  const [notice, setNotice] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<RunState>("idle");
  const [answer, setAnswer] = useState("");
  const [calls, setCalls] = useState<ToolCallView[]>([]);
  const [sources, setSources] = useState<AnswerSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const info = PROVIDERS[provider];

  function currentSettings(): AiSettings {
    return { provider, model, baseURL: info.editableBaseURL ? baseURL || info.baseURL : undefined, apiKey };
  }

  function chooseProvider(next: ProviderId) {
    setProvider(next);
    setModel(PROVIDERS[next].models[0] ?? "");
    setBaseURL(PROVIDERS[next].editableBaseURL ? PROVIDERS[next].baseURL : "");
    setError(null);
  }

  function toggleRemember(next: boolean) {
    setRemember(next);
    const saved = saveSettings(stores, currentSettings(), next);
    setNotice(saved ? (next ? "Saved on this device until you forget it." : "Kept for this tab only.") : "This browser refused to store the settings; they stay in memory.");
  }

  function forgetKey() {
    // Stop the run first: no further provider call may use the key once it
    // is announced as forgotten (see the guarded fetch in ask()).
    const running = abortRef.current;
    running?.abort(KEY_FORGOTTEN);
    abortRef.current = null;
    forgetSettings(stores);
    setApiKey("");
    setRemember(false);
    setNotice(running ? "Run stopped and key forgotten on this device." : "Key forgotten on this device.");
  }

  async function ask() {
    const text = question.trim();
    if (!text || state === "running") return;
    const checked = checkSettings(currentSettings(), { pageOrigin: window.location.origin, allowedOrigins: aiConnectOrigins() });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    saveSettings(stores, checked.value, remember);
    setNotice(null);
    setError(null);
    setAnswer("");
    setCalls([]);
    setSources([]);
    setState("running");

    const controller = new AbortController();
    abortRef.current = controller;
    // The key lives only in the provider client built here. Once the run is
    // stopped, this fetch refuses every further provider call, and nothing
    // keeps the client (or the key) after the run ends.
    const guardedFetch: typeof fetch = (input, init) => (controller.signal.aborted
      ? Promise.reject(new DOMException("The run was stopped.", "AbortError"))
      : fetch(input, init));
    let redact = checked.value.apiKey;
    const runner = createF1ToolRunner({ fetchJson: createProxyFetcher(LAB_PROXY_BASE), publicOrigin: PUBLIC_API_ORIGIN });
    const results: F1ToolResult[] = [];
    try {
      const result = streamGroundedAnswer({
        model: createLanguageModel(checked.value, { fetch: guardedFetch }),
        runner,
        question: text,
        today: new Date().toISOString().slice(0, 10),
        season,
        abortSignal: controller.signal,
      });
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          setAnswer((current) => current + part.text);
        } else if (part.type === "tool-call") {
          setCalls((current) => [...current, { id: part.toolCallId, tool: part.toolName, input: part.input }]);
        } else if (part.type === "tool-result") {
          const output = part.output as F1ToolResult;
          results.push(output);
          setCalls((current) => current.map((call) => (call.id === part.toolCallId ? { ...call, output } : call)));
          setSources(collectSources(results));
        } else if (part.type === "tool-error") {
          setCalls((current) => current.map((call) => (call.id === part.toolCallId ? { ...call, failed: String(part.error) } : call)));
        } else if (part.type === "error") {
          throw part.error;
        }
      }
      setState("done");
    } catch (caught) {
      if (controller.signal.reason === KEY_FORGOTTEN) {
        setError(null);
        setState("done");
      } else {
        setError(describeError(caught, redact));
        setState("error");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      checked.value.apiKey = "";
      redact = "";
    }
  }

  const keyField = `${formId}-key`;
  const modelList = `${formId}-models`;

  return (
    <div data-testid="ask-ai-panel">
      <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">AI provider settings</legend>
        <label className="block">
          <span className="mb-1 block text-[13px] text-white/[0.72]">Provider</span>
          <select value={provider} onChange={(event) => chooseProvider(event.target.value as ProviderId)} className="control-select w-full">
            {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-white/[0.72]">Model</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} list={modelList} spellCheck={false} autoComplete="off" className="control-input w-full" placeholder="Model name" />
          <datalist id={modelList}>{info.models.map((name) => <option key={name} value={name} />)}</datalist>
        </label>
        {info.editableBaseURL && (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[13px] text-white/[0.72]">Endpoint URL</span>
            <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} spellCheck={false} autoComplete="off" inputMode="url" className="control-input w-full" placeholder={info.baseURL || "https://…/v1"} />
          </label>
        )}
        <div className="sm:col-span-2">
          <label htmlFor={keyField} className="mb-1 block text-[13px] text-white/[0.72]">
            API key{info.keyRequired ? "" : " (optional)"}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id={keyField} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} className="control-input flex-1" placeholder={info.keyHint} />
            <button type="button" onClick={forgetKey} className={`${buttonClass} border border-white/[0.14] text-white/[0.78] hover:border-white/[0.3]`}>Forget key</button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-body-sm text-white/[0.70]">
            <input type="checkbox" checked={remember} onChange={(event) => toggleRemember(event.target.checked)} className="h-4 w-4 accent-teal" />
            Remember on this device
          </label>
          {notice && <p className="mt-1 text-body-sm text-white/[0.62]" role="status">{notice}</p>}
        </div>
      </fieldset>

      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label htmlFor={`${formId}-question`} className="sr-only">Question for your AI model</label>
        <input id={`${formId}-question`} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. Who set the fastest lap in Baku?" className="control-input flex-1" />
        {state === "running" ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className={`${buttonClass} border border-white/[0.2] text-light`}>Stop</button>
        ) : (
          <button type="submit" disabled={!question.trim()} className={`${buttonClass} bg-teal text-dark`}>Ask AI ↗</button>
        )}
      </form>
      {error && <p className="mt-3 text-body-sm text-ambre" role="alert">{error}</p>}

      {(state !== "idle" || answer) && (
        <div className="mt-5 border-t border-teal/15 pt-5" aria-busy={state === "running"}>
          <p className="text-[13px] font-medium text-white/[0.78]">
            {info.label} · {model} · at most {MAX_TOOL_STEPS} tool steps
          </p>
          <div data-testid="ai-answer" className="mt-3 whitespace-pre-wrap text-body leading-relaxed text-white/[0.84]">
            {answer || (state === "running" ? "Working through the data…" : "")}
          </div>
          {sources.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-medium text-white/[0.78]">Sources read</p>
              <ul data-testid="ai-sources" className="mt-2 flex flex-wrap gap-2">
                {sources.map((source) => (
                  <li key={source.api_url}>
                    <a href={source.api_url} target="_blank" rel="noopener noreferrer" className="inline-block rounded-full border border-white/[0.10] px-3 py-1.5 text-[12px] text-white/[0.72] hover:border-teal/30 hover:text-teal">
                      {source.api_url.replace(/^https?:\/\/[^/]+/, "")}
                      {source.kind === "openf1_enrichment" ? ` · OpenF1 ${source.licence ?? "CC BY-NC-SA 4.0"} · non-official` : source.kind === "forecast" ? " · model forecast" : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {calls.length > 0 && (
            <details className="mt-4 rounded-lg border border-white/[0.08]" data-testid="ai-tool-calls">
              <summary className="cursor-pointer px-3 py-2 text-[13px] text-white/[0.78]">
                {calls.length} tool call{calls.length > 1 ? "s" : ""}
              </summary>
              <ol className="space-y-2 px-3 pb-3">
                {calls.map((call) => (
                  <li key={call.id}>
                    <details>
                      <summary className="cursor-pointer text-body-sm text-white/[0.76]">
                        <span className="font-mono text-teal">{call.tool}</span> <span className="text-white/[0.62]">{describeInput(call.input)}</span> — {describeOutcome(call)}
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-black/30 p-2 font-mono text-[12px] text-white/[0.72]" tabIndex={0}>
                        {JSON.stringify(call.output ?? { error: call.failed ?? "pending" }, null, 2).slice(0, 4000)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
