# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
