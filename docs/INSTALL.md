# Installing the Data Lab

The Lab is a standard Next.js 16 application. Pick the option that suits you.

- [1. Node.js (development)](#1-nodejs-development)
- [2. Node.js (production)](#2-nodejs-production)
- [3. Docker](#3-docker)
- [4. Vercel](#4-vercel)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## 1. Node.js (development)

Requirements: Node.js **20.9 or later** (22 LTS recommended), npm 10+, Git.

```bash
git clone https://github.com/thejoyfulist/the-data-driver-lab.git
cd the-data-driver-lab
npm install
npm run dev
```

Open <http://localhost:3000>. Use another port with `npm run dev -- --port 4000`.

## 2. Node.js (production)

```bash
npm ci
npm run build
npm start            # serves on port 3000; PORT=4000 npm start to change it
```

The build uses `output: "standalone"`, so you can also ship only the minimal server:

```bash
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
cd .next/standalone && PORT=3000 HOSTNAME=0.0.0.0 node server.js
```

Put a reverse proxy (Caddy, nginx, Traefik…) in front for TLS.

## 3. Docker

The `Dockerfile` builds a multi-stage image on `node:22-alpine` and runs the standalone server as the
unprivileged `node` user, with a health check on `/`.

With Compose (binds to `127.0.0.1:3000`):

```bash
docker compose up --build -d
docker compose logs -f data-lab
```

Without Compose:

```bash
docker build -t the-data-driver-lab .
docker run --rm -p 127.0.0.1:3000:3000 the-data-driver-lab
```

Point the image at another API:

```bash
docker build --build-arg NEXT_PUBLIC_TDD_API_BASE=https://api.example.org -t the-data-driver-lab .
docker run --rm -p 127.0.0.1:3000:3000 -e TDD_API_BASE=https://api.example.org the-data-driver-lab
```

`NEXT_PUBLIC_*` values are compiled into the client bundle, so they are build arguments; `TDD_API_BASE` is
read at runtime by the server.

## 4. Vercel

Use the **Deploy with Vercel** button in the README, or:

1. Fork the repository.
2. In Vercel, *Add New… → Project*, import the fork. The framework preset (Next.js) is detected.
3. Optionally set the environment variables below, then deploy.

No database, secret or paid service is required.

## Environment variables

| Variable | When it is read | Default | Notes |
| --- | --- | --- | --- |
| `TDD_API_BASE` | runtime, server only | `https://api.thedatadriver.app` | Upstream for the server page and the `/api/f1` proxy. Without a trailing `/v1`. |
| `NEXT_PUBLIC_TDD_API_BASE` | build time | `https://api.thedatadriver.app` | Shown in "copy API request"; added to the CSP `connect-src`. Fallback for `TDD_API_BASE`. |
| `NEXT_PUBLIC_TDD_REPO_URL` | build time | `https://github.com/thejoyfulist/the-data-driver-lab` | "Source" link. |
| `PORT`, `HOSTNAME` | runtime | `3000`, `localhost` (`0.0.0.0` in Docker) | Standard Next.js server settings. |

A different upstream must serve the same `/v1/f1/...` contract as The Data Driver API (see [API.md](API.md)).

## Troubleshooting

- **"Season data is unavailable from the live API."** The server could not reach `TDD_API_BASE` within 8
  seconds. Check `curl https://api.thedatadriver.app/v1/health` from the machine running the Lab.
- **A view says "not published" or "unavailable".** That endpoint returned no data for the selected race
  (for example, no telemetry for an older season). This is expected; the Lab never invents values.
- **`/api/f1/...` answers 404.** The path is not on the proxy allow-list (`src/lib/proxy-allowlist.mjs`).
- **Playwright cannot find a browser.** Run `npx playwright install chromium` once.
