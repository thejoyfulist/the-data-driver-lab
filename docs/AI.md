# Ask the data with your own AI model

The Data Lab answers questions in two ways:

- **Grounded (default)** — the deterministic question endpoint of The Data Driver API
  (`POST /v1/f1/chat`). No language model is involved: answers are built from published data only.
- **AI — your own key** — you connect a model from a provider of your choice. The model answers by
  calling read-only F1 tools over the public API, and must cite what it read. Nothing is sent to a
  model unless you open this mode and ask a question.

The AI mode is optional, off by default and loaded only when you open it: the default Lab does not
download the AI SDK.

## Providers

| Provider | Endpoint used by the browser | Key | Suggested models |
| --- | --- | --- | --- |
| Anthropic | `https://api.anthropic.com/v1` | required | `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-4-5` |
| OpenAI | `https://api.openai.com/v1` (Chat Completions) | required | any chat model with tool calling |
| OpenRouter | `https://openrouter.ai/api/v1` | required | any model with tool calling |
| Groq | `https://api.groq.com/openai/v1` | required | any model with tool calling |
| Ollama (local) | `http://localhost:11434/v1` by default | not needed | a local model with tool support (for example `qwen3`, `llama3.1`) |
| OpenAI-compatible endpoint | the URL you enter | optional | whatever the endpoint serves |

The model field is free text: the suggestions are only a starting point, and the model must support
tool (function) calling. Model names change; check your provider's list.

The integration uses the [Vercel AI SDK](https://ai-sdk.dev) (`ai`, `@ai-sdk/anthropic`,
`@ai-sdk/openai-compatible`). OpenAI, OpenRouter, Groq, Ollama and custom endpoints all go through the
OpenAI-compatible Chat Completions interface.

## Where your key goes

- **Straight from your browser to the provider.** The page calls the provider's API directly. The key is
  never sent to The Data Driver, to the `/api/f1` proxy or to any `thedatadriver.app` host. For
  Anthropic, the page sends the `anthropic-dangerous-direct-browser-access` header that Anthropic
  requires for calls made from a web page with the user's own key.
- **Stored in this browser only.** By default the settings (provider, model, endpoint, key) live in
  `sessionStorage` and disappear when the tab is closed. Tick **Remember on this device** to keep them
  in `localStorage`; untick it or press **Forget key** to remove them. Forget key clears both stores,
  and if a question is running it first stops it: no further call to the provider uses the key.
- **Refused endpoints.** A custom endpoint must use HTTPS (plain HTTP only on the local machine), must
  not contain a user name or password, and cannot be a public IP address, this site's own host (or, on
  the local machine, the Lab's own port under another name such as `127.0.0.1` for `localhost`) or a
  `thedatadriver.app` host. The host is normalised before the check (lower case, trailing dots removed,
  `%2e` decoded, IDNA/punycode), so `API.THEDATADRIVER.APP.` or `api%2ethedatadriver%2eapp` are refused
  like `api.thedatadriver.app`.
- **Content Security Policy (enforced).** The page sends `Content-Security-Policy` (not Report-Only).
  Its `connect-src` lists the four hosted providers above, `http://localhost:11434` and
  `http://127.0.0.1:11434` for Ollama, and nothing else for the AI mode. An endpoint outside this list
  is refused in the form ("For another endpoint, run the open-source Data Lab…") instead of failing in
  the browser.
- **Your own endpoint (self-hosted Lab).** An arbitrary OpenAI-compatible endpoint, or Ollama on another
  port, is possible in a Lab you build yourself: list its origins at build time in
  `NEXT_PUBLIC_TDD_AI_CONNECT_SRC` (space-separated; HTTPS only, plain HTTP only for the local machine;
  a `thedatadriver.app` host or an invalid entry fails the build). The CSP and the settings form use the
  same list. On thedatadriver.app the list is empty: only the providers above can be reached.

Anyone who can run JavaScript in the page (a malicious browser extension, for instance) can read a key
held by the page. Use a key you can revoke, with a spending limit, and prefer a local model when that
matters.

## Ollama and other local servers (CORS)

The browser enforces CORS: a local server must allow the Lab's origin, otherwise the request fails with
"The provider could not be reached from this browser (network or CORS)".

For Ollama, set `OLLAMA_ORIGINS` before starting the server:

```bash
# The Lab on thedatadriver.app
OLLAMA_ORIGINS="https://thedatadriver.app" ollama serve
# A Lab running locally on port 3000
OLLAMA_ORIGINS="http://localhost:3000" ollama serve
```

On macOS with the desktop app: `launchctl setenv OLLAMA_ORIGINS "https://thedatadriver.app"`, then
restart Ollama. Pull a model that supports tools (`ollama pull qwen3`) and choose **Ollama (local)** in
the Lab.

Other OpenAI-compatible servers (LM Studio, vLLM, llama.cpp server, a proxy of your own) need the same:
answer the `OPTIONS` preflight and send `Access-Control-Allow-Origin` for the Lab's origin, and allow the
`authorization` and `content-type` request headers.

## How answers stay grounded

- **Tools, not memory.** The model receives a catalogue of read-only tools
  (`src/lib/f1-tools/catalogue.mjs`) and a system prompt that tells it to answer only from the tool
  results of the conversation, to say "not available" when the tools do not have the data, to treat
  forecasts as forecasts, to label OpenF1 data as non-official enrichment (CC BY-NC-SA 4.0), to cite the
  API URLs it used and to write in British English.
- **At most 8 tool steps** per question.
- **Everything is shown.** Under the answer, the Lab lists the sources read and every tool call with its
  input and its JSON result.
- **A model can still be wrong.** The tools reduce the risk; they do not remove it. Check the sources.

### Tool catalogue

All tools are `GET` reads of paths the `/api/f1` proxy already allows. Each result is compact JSON with a
`source` block (`name`, `kind`: `official` / `openf1_enrichment` / `forecast` / `derived`, `licence`,
`attribution`, `api_url`, `fetched_at`). The API's own `availability` and `reason` fields are passed
through verbatim; errors and empty datasets come back as such, never filled in. Lists are bounded (row
limits, a 20-lap window) and say when they were shortened: `truncated` gives `{ shown, total }` for a
cut list. Each serialised result, API error messages included, is capped at 8,000 characters: text
fields longer than 600 characters are cut with the marker `…[truncated]` (`truncated.text_fields`,
`truncated.original_chars`), then lists are shortened further if needed.

| Tool | Reads |
| --- | --- |
| `f1_resolve_race` | find a race by name, circuit, city, country, "round 15", "next" or "latest" (calendar) |
| `f1_resolve_driver` | find a driver by code or name (drivers' standings) |
| `f1_calendar`, `f1_next_race` | season calendar, next race |
| `f1_driver_standings`, `f1_constructor_standings` | championship standings |
| `f1_race_results`, `f1_qualifying` | official classifications |
| `f1_fastest_laps`, `f1_practice_best` | fastest race laps, best laps per practice session |
| `f1_driver_laps` | one driver's lap times (summary, optional lap window) |
| `f1_pit_stops` | pit stops, optionally for one driver |
| `f1_safety_cars`, `f1_incidents`, `f1_weather` | race control and weather (OpenF1 enrichment) |
| `f1_race_forecast`, `f1_qualifying_forecast` | The Data Driver model forecasts |
| `f1_head_to_head` | two drivers' head-to-head record |
| `f1_race_data_status` | which official datasets of a race are published |

Races are addressed by `api_round`, the API's key for the race (cancelled races keep their slot). The
formula1.com round number is `official_round`. `toolJsonSchemas()` exports every input as JSON Schema,
ready for an MCP server.

## Evaluation bench

`scripts/ai-eval/` holds about fifty English F1 questions with verifiable answers, frozen from the public
API with their date (`truth.json`, expected values computed from the raw API responses) and the responses
themselves (`api-snapshot.json`).

```bash
npm run eval:ai -- --mode mock            # fake model + frozen snapshot: no network, no key (runs in CI via npm test)
npm run eval:ai -- --mode deterministic   # the grounded endpoint, POST /v1/f1/chat (rate limited)
TDD_EVAL_API_KEY=… npm run eval:ai -- --mode provider --provider ollama --model qwen3
npm run eval:ai:truth                     # re-freeze truth.json and api-snapshot.json from the API
```

Each answer is graded **exact**, **correct refusal** (an unanswerable question answered "not
available"), **unnecessary refusal** (a failed question), **wrong** or **error**. The grader checks
meaning, not the presence of words:

- **AI runs (mock and provider)** ask the model to end its reply with a JSON block
  `{"answer_value": …, "refused": true|false}`. Each expected value must equal one of the listed values
  (after normalising case, accents, units such as "357 points", positions such as "P2"/"2nd", and a
  surname given as a full name); a value found only inside a longer string does not count. A missing or
  malformed block is wrong, and so is prose that negates an expected value.
- **The deterministic endpoint** answers in sentences: an expected value counts only in a clause that does
  not negate it, so "Kimi Antonelli is not the leader; Max Verstappen is" is wrong, not exact.

A run **passes** only with no wrong answer, no error, and exact answers for at least 90 % of the
answerable questions (`--min-exact 0.9`, configurable). Refusing every question therefore fails.
Results are written as JSON and Markdown to `scripts/ai-eval/results/` (ignored by Git).

In provider mode the tools read the frozen snapshot by default (`--tools live` reads the public API), the
key is read from `TDD_EVAL_API_KEY` and never written anywhere, and hosted providers (Anthropic, OpenAI,
OpenRouter, Groq) require `--allow-paid`, because each run is billed to the key's account.

The mock mode replaces the language model with `scripts/ai-eval/fake-openai.mjs`, a local
OpenAI-compatible server that plays each question's tool plan and reads the answer from the tool results
it receives. It checks the whole loop (AI SDK, tools, proxy paths, grading), not a model's intelligence.
