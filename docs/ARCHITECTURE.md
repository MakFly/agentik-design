# Architecture — agentik-design

> **Read this before adding files, moving code, or writing migrations.**
> This document is the source of truth for the project layout. It is auto-loaded
> into every agent session via `@docs/ARCHITECTURE.md` in `AGENTS.md`.
> If the repository and this file disagree, the repository wins — then fix this file.

## Monorepo layout

```
agentik-design/
├── apps/
│   ├── web/      Next.js front-end (App Router, React Query, shadcn/ui)
│   ├── engine/   Hono/TypeScript API + business logic (run on Bun)
│   └── daemon/   Go agent runtime (register / heartbeat / claim / execute)
├── packages/
│   ├── workflow-schema/   shared Zod/TS contracts (agents, models, events, daemon-protocol)
│   └── workflow-engine/   shared workflow execution helpers
└── docs/         specs, ADRs, this file
```

Bun workspaces (`apps/*`, `packages/*`). **Always use `bun`/`bunx`** — never npm/pnpm/yarn.

## Engine — layered architecture (`apps/engine/src/`)

The engine is split into layers. Do not reintroduce flat `*-repo.ts` files at the
`src/` root — every module belongs to a layer.

```
╔═══════════════════ apps/engine/src/ ═══════════════════╗
║  app/         server bootstrap + middleware            ║
║  gateway/     HTTP edge: auth, route mounting          ║
║  domains/     business logic, one folder per domain:   ║
║    agents · channels · chat (+orchestrator)            ║
║    learning (+memory, reviews) · mcp · projects        ║
║    runs (+controls) · settings · workflows             ║
║  execution/   daemon (repo+service+routes) · worker    ║
║               · bundle                                 ║
║  infra/       db (client, ids, schema/*.ts), crypto    ║
║  jobs/        background jobs (task-scanner, …)         ║
║  observation/ logging / metrics                        ║
╚════════════════════════════════════════════════════════╝
```

### Domain folder convention

A domain under `domains/<name>/` typically contains:

- `repo.ts` — data access (Drizzle queries), the only layer that touches the DB
- `service.ts` — business logic orchestrating repos
- `routes.ts` — Hono routes, mounted from `app/server.ts`
- `schemas.ts` — Zod request/response schemas
- `index.ts` — barrel export (public surface of the domain)

**Cross-domain imports go through a domain's `index.ts` barrel, not deep paths.**
If domain A needs a helper from domain B that B does not export, promote the helper
to `infra/` rather than reaching into `B`'s internals.

### DB schema

`infra/db/schema/` is **split by domain** (`agents.ts`, `channels.ts`, `runs.ts`,
`learning.ts`, `mcp.ts`, `projects.ts`, `settings.ts`, `workflows.ts`, `auth.ts`,
`_shared.ts`). Never collapse it back into a single `schema.ts`.

## Tests — `apps/engine/tests/` mirrors `src/`

**All engine tests live under `apps/engine/tests/`, never next to source.**
The folder tree mirrors `src/` so each test sits at the same path as its subject:

```
apps/engine/
├── src/domains/channels/repo.ts
└── tests/domains/channels/channels-repo.test.ts   ← mirrors the domain path
```

Mapping in place today:

| Test subject              | Test location                               |
|---------------------------|---------------------------------------------|
| `domains/channels`        | `tests/domains/channels/`                   |
| `domains/chat`            | `tests/domains/chat/`                        |
| `domains/learning`        | `tests/domains/learning/`                    |
| `domains/projects`        | `tests/domains/projects/`                    |
| `domains/runs`            | `tests/domains/runs/`                        |
| `execution/daemon`        | `tests/execution/daemon/`                    |
| `gateway` (auth)          | `tests/gateway/`                             |
| `infra` (crypto)          | `tests/infra/`                               |
| `jobs`                    | `tests/jobs/`                                |

Rules:

- **Import depth**: a test imports source via a relative path back into `src/`
  (`../../../src/...` for `tests/<a>/<b>/`, `../../src/...` for `tests/<a>/`).
  Never import a sibling test's helpers across domains.
- `bun test` discovers `*.test.ts` recursively — no config needed.
- `tsconfig.json` `include` lists both `src` and `tests`, so tests are type-checked.
- DB-backed tests must **auto-skip when Postgres is unavailable** (guard on the
  connection), so `bun test` stays green on a bare checkout.
- New domain → create `tests/domains/<name>/` alongside it.

## Migrations (Drizzle)

- One migration = one numbered SQL file in `apps/engine/drizzle/`.
- **Name migrations explicitly** by intent — `0026_unified_runs.sql`, not the
  auto-generated `0024_strong_maverick.sql`. Use
  `bunx drizzle-kit generate --name <intent>`.
- Run `bunx drizzle-kit check` before generating a new migration to catch schema
  drift from previously auto-named migrations.
- **Destructive migrations** (`DROP TABLE`, column drops) are irreversible — call
  it out in the PR/commit and snapshot data first if it matters.

## Invariants (do not break)

1. Engine `src/` root holds no `*.test.ts` and no flat `*-repo.ts` — everything is layered.
2. `repo.ts` is the only DB-touching layer inside a domain.
3. Cross-domain access goes through `index.ts` barrels; shared helpers live in `infra/`.
4. `infra/db/schema/` stays split per domain.
5. Tests live in `apps/engine/tests/` mirroring `src/`.
6. Migrations are explicitly named; check for drift before generating.

## Before marking work complete

Run from the affected app:

```
bunx tsc --noEmit      # engine + web
bun test               # engine
go build ./... && go test ./...   # daemon (from apps/daemon)
```
