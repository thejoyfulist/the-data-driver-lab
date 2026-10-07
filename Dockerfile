# syntax=docker/dockerfile:1
# Small production image: Next.js standalone output on Node 22 Alpine,
# running as the unprivileged "node" user.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_TDD_API_BASE=https://api.thedatadriver.app
ARG NEXT_PUBLIC_TDD_REPO_URL=https://github.com/thejoyfulist/the-data-driver-lab
ENV NEXT_PUBLIC_TDD_API_BASE=$NEXT_PUBLIC_TDD_API_BASE \
    NEXT_PUBLIC_TDD_REPO_URL=$NEXT_PUBLIC_TDD_REPO_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]
