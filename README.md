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

## Installation cible

Le serveur Agentik et le runtime agent ne se déploient pas au même endroit.

### Control plane

```bash
docker compose -f docker-compose.selfhost.yml up -d
```

Ce stack lance le web, l'engine, le worker, Postgres et Redis. Il ne lance pas
de daemon par défaut: les agents doivent tourner sur les machines qui possèdent
les CLIs locales.

### Daemon local

Depuis Settings > Connections, créer un token puis lancer sur la machine cible:

```bash
agentik setup --url http://localhost:8787 --token dtkn_... --runtimes echo,claude,hermes --start
agentik doctor
```

La tab peut aussi lancer l'installation depuis le bouton "Install and start"
quand `apps/web` tourne sur la machine cible. Ce bouton appelle une route locale
Next qui execute le binaire `agentik`, puis affiche `agentik daemon status`.

Le chemin Docker daemon reste disponible pour des runners headless contrôlés,
mais le chemin principal est le CLI natif afin de détecter `claude`, `hermes`,
`codex` ou `gemini` depuis le `PATH` et leurs sessions locales.

## Licence

À définir.
