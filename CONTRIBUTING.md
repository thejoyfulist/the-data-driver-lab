# Contributing

Thanks for helping improve the Data Lab. Bug reports, new views, accessibility fixes and documentation are all welcome.

## Ground rules

1. **No invented data.** A view renders what the API returns, or says clearly that it is unavailable. Never
   substitute a prediction for a measured result, interpolate missing laps or hard-code figures.
2. **Every API field is optional.** Payload types in `src/lib/lab-client.ts` are all optional/nullable;
   check before you render.
3. **Keep provenance visible.** New views use `ViewCard`, which shows the request, the source and the licence.
   OpenF1-derived data must stay labelled as non-official enrichment (CC BY-NC-SA 4.0).
4. **Official names.** Use driver, team and Grand Prix names exactly as the API returns them (they follow formula1.com).
5. **No third-party assets.** Do not add team logos, driver photographs, car liveries or F1 marks. Teams are identified by a colour swatch.
6. **English with British spelling** in user-facing copy (tyre, colour); American spelling in code identifiers.

## Setup

```bash
npm install
npx playwright install chromium   # once, for end-to-end tests
npm run dev
```

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

CI runs the same commands. End-to-end tests start a local mock API (`e2e/mock-api.mjs`); never point tests
at the production API. When a view needs a new endpoint, add it to `src/lib/proxy-allowlist.mjs`, to the mock
API and to `docs/API.md`, with tests.

## Commits and pull requests

- Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
- [Conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `style:`, `test:`, `chore:`.
- One topic per pull request; describe what changed, how you tested it, and add a screenshot for visual changes.
- Visual changes follow the existing design tokens in `tailwind.config.ts` (dark surfaces, restrained accent colours, serif titles, monospace numbers).

## Reporting data errors

If a figure looks wrong, first compare it with the API response (`Copy API request` in the view). If the API
itself is wrong, open an issue with the endpoint, the expected value and an official source (formula1.com or fia.com).

By contributing you agree that your contributions are licensed under the MIT licence of this repository and
that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
