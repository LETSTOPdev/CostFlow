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
# Start the server ONLY. The idempotent migration runs as Railway's separate
# pre-deploy phase (railway.json `preDeployCommand`), not chained into start —
# chaining `migrate && start` once hung after migrate and starved the
# healthcheck (no server bound), failing every deploy. Keeping them separate
# lets the server bind promptly and the healthcheck pass.
#
# Run node DIRECTLY as PID 1 (not `pnpm start`) so Railway's SIGTERM on redeploy
# reaches the server process itself. A `pnpm`/`tsx` wrapper in the signal path
# meant SIGTERM was delivered to the wrapper and the server was torn down before
# its graceful drain (app.close → GOAWAY) finished — which severed keep-alive
# connections and made post-deploy sign-out POSTs fail. As PID 1 the server owns
# the signal, drains cleanly, and exits 0. `--import tsx` runs the TypeScript
# in-process (no child fork). Assets/schema are resolved via import.meta.url, so
# the working directory (/app) is irrelevant.
CMD ["node", "--import", "tsx", "apps/web/src/main.ts"]
