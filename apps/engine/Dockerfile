# Engine image (Hono + Bun). Build context = repo root (monorepo).
# Only the engine + its workspace packages are copied, so `bun install` resolves
# a minimal workspace (apps/web / xulux are excluded via .dockerignore + not copied).
FROM oven/bun:1.3.13

WORKDIR /app

# Manifests first for layer caching, then the workspace deps it actually needs.
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/engine ./apps/engine

RUN bun install

WORKDIR /app/apps/engine
ENV PORT=8787
EXPOSE 8787

# DB must already be migrated (run `make db/migrate` against infra-postgres).
CMD ["bun", "run", "src/main.ts"]
