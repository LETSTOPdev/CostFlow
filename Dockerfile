# CostFlow web — production image (doc 09 P4.2 §7).
# No build/emit step (D-2): the app runs from source via tsx. We install the
# full workspace so @costflow/* resolve, then run the web edge as a non-root
# user. The image contains no secrets — every secret is injected by the
# platform (Railway variables) at runtime.
FROM node:22-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# Enable pnpm via corepack (pinned to the repo's version).
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Install dependencies with a cached, frozen lockfile layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json ./
RUN pnpm install --frozen-lockfile --prod=false

# Drop privileges.
RUN useradd --uid 10001 --create-home costflow \
  && chown -R costflow:costflow /app
USER costflow

EXPOSE 3000
# The platform sets PORT, DATABASE_URL, COSTFLOW_* secrets, COSTFLOW_ENV=production.
# Run the idempotent migration before serving so schema changes (e.g. P4.4's
# additive columns/tables) are applied on every deploy — the app never serves
# on a stale schema. schema.sql is `create ... if not exists` / `add column if
# not exists`, so this is safe to run on every boot. railway.json's
# startCommand mirrors this; keep them in sync.
CMD ["sh", "-c", "pnpm --filter @costflow/web migrate && pnpm --filter @costflow/web start"]
