# Agentik

Monorepo Bun (workspaces) pour une plateforme d'agents et de workflows : chat assistant, moteur de workflows façon n8n, et harness d'exécution d'agents.

## Structure

```
apps/
  web/      Frontend Next.js (assistant-ui + AI SDK) — chat, tools, dashboard
  engine/   Moteur de workflows (Hono/Bun) — exécution n8n-like
  daemon/   Daemon Go du harness d'agents (runtime temps réel)
packages/
  workflow-schema/  Schémas partagés des workflows
  workflow-engine/  Logique du moteur de workflows
```

## Prérequis

- [Bun](https://bun.sh)
- Docker (services partagés : Postgres, Redis, Mailpit)

## Démarrage

```bash
bun install
docker compose up -d
```

## Licence

À définir.
