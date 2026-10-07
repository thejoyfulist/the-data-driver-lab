# Security policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Use GitHub's
[private vulnerability reporting](https://github.com/thejoyfulist/the-data-driver-lab/security/advisories/new)
for this repository. Include the affected version or commit, reproduction steps and the impact you observed.

You can expect an acknowledgement within a week. Please give us reasonable time to fix the issue before any
public disclosure.

## Scope

In scope: this application's code — the server page, the `/api/f1` proxy and its allow-list, the client
views, the Docker image and the CI configuration.

Out of scope here: The Data Driver API itself (`api.thedatadriver.app`) and the website
(`thedatadriver.app`). Report issues with those through the same private channel and mark them as such;
they will be routed to the right place. Do not run load tests, scanners or denial-of-service tests against the public API.

## Hardening notes

- The application holds no secrets and needs none: the API is public and keyless. Never commit `.env*` files.
- The proxy only forwards the read endpoints listed in `src/lib/proxy-allowlist.mjs` and one `POST`
  (`/v1/f1/chat`, 8 KB body limit). Any other path answers 404 without an upstream request.
- Responses carry a Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy.
- The Docker image runs as the unprivileged `node` user.
