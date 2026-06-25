# Web image (Next.js + Bun). Build context = repo root.
FROM oven/bun:1.3.13

WORKDIR /app

COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN bun install

WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
