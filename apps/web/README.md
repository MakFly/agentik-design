# @agentik/web

Next.js (App Router) front-end for the Agentik harness. Talks to `apps/engine` (Hono/Bun) via Next rewrites.

## Dev

```bash
bun install
bun run dev   # http://localhost:3000
```

The engine must be running for live data (see the root `Makefile` / `README.md`). Without it, the UI renders but `/system`, agents, runs, etc. are unreachable.

> Package manager: **bun** only — never npm/yarn/pnpm.
