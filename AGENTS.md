# Data Lab: rules for every agent (Codex included)

Open-source Formula 1 analysis workspace (Next.js 16): race reports, pace, tyre strategy, positions and head-to-heads drawn from a public API, plus a read-only MCP server. `README.md` and `CONTRIBUTING.md` describe it: read them before any change or review.

- Unavailable data stays unavailable: nothing is guessed or back-filled, and every view shows the request behind it.
- Some source files are mirrored from the live site (list in `CONTRIBUTING.md`); a change to them is ported back by a maintainer.
- Checks, as in CI: `npm ci`, `npm audit --omit=dev --audit-level=high`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npm run test:e2e` (Playwright; `npx playwright install chromium` once).

When reviewing a branch, also apply `docs/code_review.md`, the review checklist built from past findings on this repo.
