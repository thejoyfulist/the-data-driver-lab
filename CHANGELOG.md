# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The Lab is a workspace: one view at a time (kept in the URL, deep links, Back and Forward), a side
  navigation grouped by Season, Race, Compare and Ask, a compact bar (race selector, driver chips, session
  status "Next: … · in …" or "Live", `⌘K`, `</> API`, "Share view") and an inspector panel.
- CSV, JSON and "Copy API request" moved to a "⋯" menu per view; `</> API` reveals the requests on demand.
- Interface text is at least 12 px; monospace is kept for numbers and code; sources fit on one line per view.
- Empty states are one line with the API's reason.
- Phones: one selector, scrolling view pills, the first chart in the first screen, a bottom action bar.

### Added

- Race report, the default view: four key figures computed from the API (winner, fastest lap, biggest
  grid-to-finish gain with the same rule as the grounded answer, neutralisations) and a grid of cards.
- "What stands out": deterministic sentences from the rows on screen, or an explicit refusal.
- Charts: shared cursor across charts on the same axis (hover and keyboard) with a values tooltip,
  non-overlapping end labels, clickable legend.

- Optional "AI — your own key" mode in Ask the data: Anthropic, OpenAI, OpenRouter, Groq, Ollama or any
  OpenAI-compatible endpoint, called directly from the browser (Vercel AI SDK). The grounded endpoint stays
  the default. Key in `sessionStorage` by default, opt-in "Remember on this device", "Forget key".
- Read-only F1 tool catalogue (`src/lib/f1-tools/`) with JSON Schema inputs, bounded outputs, source and
  licence on every result.
- Evaluation bench (`scripts/ai-eval/`): about fifty frozen questions, mock, deterministic and provider modes.
- `NEXT_PUBLIC_TDD_AI_CONNECT_SRC` to allow extra AI endpoints in the CSP.

## [1.0.0] — 2026-10-07

First public release of the Data Lab as a standalone application.

### Added

- Twelve linked views: field, championship progression, constructors, lap-by-lap pace, fastest laps, pit stops
  and stints, race timeline (safety cars, incidents, weather), driver head-to-head, practice and qualifying
  sessions, season comparison, grounded questions, data explorer.
- CSV and JSON export and "copy API request" on every view; shareable URL state; `⌘K` command palette.
- Server rendering of the default race (readable without JavaScript) with 5-minute incremental regeneration.
- Same-origin `/api/f1` proxy with a path allow-list.
- Configurable upstream (`TDD_API_BASE`, `NEXT_PUBLIC_TDD_API_BASE`).
- Dockerfile (Node 22 Alpine, non-root, standalone output), `docker-compose.yml`, Deploy with Vercel button.
- Unit tests (`node:test`), Playwright end-to-end tests against a mock API, CI workflow.
- Documentation: README, installation guide, API notes, data licences, contribution guide, code of conduct, security policy.
