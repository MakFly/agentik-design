# Roadmap — Plateforme Multica (ops business) 🏢

Document de référence pour la surface **plateforme Multica** : l'ops business sous
`/[team]/platform/*` (Command Center, Projects, Runs, Agents, Tools, Observability,
Runtimes, Settings) **et** les domaines engine que l'assistant pilote in-chat (agents,
tools, channels, skills, cron). Chaque phase est rédigée pour être **directement
actionnable** : objectif, état réel du code, périmètre, conception détaillée (flux +
fichiers), critères d'acceptation et risques.

> Pendant produit pour l'IA perso : voir **`docs/assistant-roadmap.md`** (Personal
> Assistant). Les items qui couplent les deux surfaces sont signalés et listés dans la
> section *Couplage avec l'assistant* en bas de ce document.

Convention : prose en français, identifiants/chemins/code en anglais.

---

## Contexte & état actuel (livré)

La plateforme est la **sidebar nav complète** (`PlatformShell` / `sidebar.tsx`) montée sous
`/[team]/platform/*`. Elle réutilise les domaines engine d'orchestration : agents, runs,
tools (MCP), channels, signals/cron, runtimes, settings.

Acquis structurants côté ops :

- **Deux surfaces** (cf. *Architecture*) : la plateforme sous `/[team]/platform/*`
  (ce doc) et le **Personal Assistant** à la racine `/[team]/*` (`docs/assistant-roadmap.md`).
  Layouts dédiés via le route group `platform/` et `(assistant)/`.
- **Exécution sans daemon** : `EMBEDDED_WORKER=true` (engine `.env` + Makefile `dev/engine`)
  → worker in-process (`execution/embedded/worker.ts`) qui exécute via CLI locale
  (`runtime/cli.ts`) ou clé provider (`runtime/api.ts`). C'est la **voie async/daemon/CLI**
  (automations, cron) ; la gateway in-process ne couvre que le *fast-path interactif* du chat.
- **Runs & steps** : les tours d'un run sont stockés dans `run_messages` (`seq`, `type`,
  `tool`, `content`, `input`) — projetés en `Step[]` par `getRunDetail`
  (`domains/runs/repo.ts`) et exposés par `GET /api/v1/runs/:id` (`RunDetail { run, steps }`).
  `appendAssistantTurn` (`domains/chat/repo.ts`) écrit le tour à la complétion du run
  (`onRunCompleted`, `domains/runs/service.ts`) avec un event realtime `chat.message`.
- **Agents** : domaine complet — `domains/agents/{routes,repo}.ts` (`createAgent`,
  `publishAgent`, versions, roster). Web : `features/agent-registry`, `features/agent-builder`.
- **Tools / MCP** : `domains/mcp` (+ `routes`), web `features/...tools`. Catalogue
  builtin : `lib/tools/catalog.ts`, custom tools : `lib/tools/custom-tools.ts`.
- **Channels / Telegram** : `domains/channels/{routes,repo,service}.ts` +
  `domains/channels/telegram/*` (client, poller, dispatch, execute-command, bindings).
  Web : `features/channels`.
- **Agent par défaut** : agent généraliste **Assistant** (`runtimeKind: "openai"`, seedé
  dans `jobs/seed-smb.ts`).
- **Tests** : `apps/web/e2e/nav.spec.ts` (chemins `/platform/*`).

---

## Architecture — la surface plateforme (livré)

L'app expose **deux produits** dans un même `app/[team]/(app)`, via des layouts distincts.
Vue d'ensemble (la plateforme est la branche `platform/`) :

```
/[team]/(app)/layout              = session seule (SessionHydrator + SessionGuard)
  ├─ (assistant)/layout           = AssistantShell  (sidebar minimale OpenClaw)   → assistant-roadmap.md
  │     /[team]/{chat,memory,automations,channels}
  │     ▲ haut sidebar : <AgentSwitcher/> + bouton « + »  ·  bas : « Multica platform → »
  └─ platform/layout              = PlatformShell    (sidebar nav complète)        ◄── CE DOC
        /[team]/platform/{command-center,projects,runs,agents,tools,observability,
          runtimes,settings}       ·  haut sidebar : lien « ← Assistant »
```

- **Plateforme Multica** (`/platform/*`) = l'ops business : **Command Center, Projects,
  Runs, Agents, Tools, Observability, Runtimes, Settings**. Sidebar = `PlatformSidebar`
  (`sidebar.tsx`), shell = `platform-shell.tsx`.
- **Routing & liens** : `config/nav.ts` porte `surface: "assistant" | "platform"` par item ;
  `hrefFor(team, segment, rest?)` préfixe automatiquement `/platform/` pour les segments
  plateforme (`PLATFORM_SEGMENTS`). Tous les liens passent (ou doivent passer) par `hrefFor`.

---

## RAF — Reste à faire (plateforme) 🏢

| Item | Réf. | Ce que ça implique |
|---|---|---|
| **Cron — UI de gestion** | Phase 3b | Lister/éditer les signals `schedule` + activer `SCHEDULER_ENABLED`. Ops ⇒ plateforme (près de Runs/Agents). *Voir « Décisions de périmètre ».* |
| **Skills — CRUD** | Phase 3b | Domaine `domains/skills` + UI `features/skills`, rattaché aux **Agents** (plateforme). L'effet (injection au prompt) se voit côté chat. |
| **Domaines pilotés in-chat** (agents/tools/channels) | Phase 3 | Les APIs consommées par le drawer/slash du chat — garantir RBAC, schémas de binding, invalidations. *Couple l'assistant.* |
| **Command palette *surface-aware*** | — | `command-palette.tsx` liste encore **tout** `NAV_ITEMS` (assistant+platform) → scoper à la surface courante (ou deux palettes). |
| **Nav mobile plateforme** | — | `MOBILE_NAV_KEYS` inutilisé → brancher la bottom-nav plateforme ou retirer le concept. |

### Décisions de périmètre à trancher (impactent la plateforme)
- **Automations / Cron** : la *gestion* des tâches cron vit côté **plateforme** (ops, près
  des Runs) ou **assistant** (« mes routines ») ? Aujourd'hui *Automations* est en assistant
  mais le backend cron est de l'ops — incohérence à lever. *(Vue assistant :
  `docs/assistant-roadmap.md`.)*
- **Skills** : gestion en **plateforme** (près des Agents) avec usage en chat — à valider.
- **Memory / Telegram** : confirmés côté **assistant** (contexte perso) ou plutôt **admin
  plateforme** ? Le split actuel les met en assistant.

→ Ces choix déterminent **où** (quel shell/route) sont implémentées les Phases 3 / 3b.

---

## Phase 3 — Domaines pilotés in-chat (agents / tools / channels) — 🏢 Platform (back)

> **Couplage** : la face **UI** (slash commands + drawer « Manage ») vit dans le chat,
> décrite dans `docs/assistant-roadmap.md` § *Phase 3*. Ce volet couvre les **domaines
> engine** que cette UI consomme, sans réécriture.

### Objectif
Garantir que les domaines **agents / tools (MCP) / channels** exposent ce qu'il faut pour
être pilotés depuis le chat (création/édition/attache/binding), avec les bons schémas et
permissions — **zéro nouveau backend**, on **réutilise**.

### État actuel (ce qui existe déjà côté engine)
- **Agents** : `domains/agents/{routes,repo}.ts` (`createAgent`, `publishAgent`, versions,
  roster). Web : `features/agent-registry`, `features/agent-builder`.
- **Tools / MCP** : `domains/mcp` (+ `routes`), web `features/...tools` ; catalogue builtin
  `lib/tools/catalog.ts`, custom `lib/tools/custom-tools.ts`.
- **Channels / Telegram** : `domains/channels/{routes,repo,service}.ts` +
  `domains/channels/telegram/*`. Web : `features/channels`.

### Périmètre
- **Inclus (back/contrat)** :
  - Agents : `useCreateAgent` + `publishAgent` utilisables sans le builder complet ;
    invalidation `qk.agents.*` après publish (l'agent apparaît dans le sélecteur chat).
  - Tools : endpoint d'attache/détache d'un tool sur l'agent courant.
  - Channels : binding (channel → agent) via `POST /channels/:id/bindings` ; vérifier le
    schéma dans `domains/channels/schemas.ts`.
  - RBAC : `agent:write`, `tool:write`, `settings:write` cohérents sur ces chemins.
- **Exclus** : l'UI in-chat (cf. assistant) ; réécrire les features existantes.

### Conception détaillée

```
chat (drawer/slash) ──► APIs plateforme
        │
        ├─► agents  : createAgent / publishAgent / roster   (domains/agents)
        ├─► tools   : attach/detach MCP sur l'agent          (domains/mcp)
        └─► channels: bind telegram (channel → agent)        (domains/channels)
              └── après écriture : invalidation react-query côté web
```

### Critères d'acceptation
- Un agent créé via l'API (publié) est visible dans `/demo/platform/agents` et
  sélectionnable dans le chat.
- Une attache de tool est reflétée dans le builder.
- Un binding Telegram est vérifiable via l'API (`/demo/channels`).

### Tests
- Engine (vitest) : agents create/publish ; channels binding.
- E2E couvert côté assistant (slash/drawer).

### Risques
- Surface large → livrer **incrémentalement** (agents, puis tools, puis channels).
- Cohérence des permissions RBAC.

---

## Phase 3b — Skills & Cron — 🏢 Platform (gestion) · 🗣️ effet en chat

### Objectif
Donner une **gestion réelle des skills** et des **tâches cron** accessibles côté plateforme
(et idéalement pilotables depuis le chat), à parité avec OpenClaw (sections « Skills » et
« Tâches cron »).

### État actuel — important
- **Cron : déjà implémenté.** `jobs/scheduler.ts` (`startScheduler`, opt-in
  `SCHEDULER_ENABLED`) déclenche les **signals de kind `schedule`** dont l'expression cron
  matche (`domains/signals/service.ts`, `domains/signals/cron.ts`,
  `listScheduledSignals`). Le seed crée déjà un signal `kind: "schedule"`
  (`seed-smb.ts:586`). → Le « backend cron » **n'est pas à créer**, il est à **activer +
  exposer**.
- **Skills : registre builtin, pas de CRUD.** `domains/chat/skills.ts` définit des skills
  déterministes (`gmail.read`, `gmail.send`) matchés par intention ; l'agent porte
  `config.skills: string[]`. Il n'existe pas de domaine `skills` (define/list/attach).

### Périmètre
- **Cron** (faible effort) :
  - Activer `SCHEDULER_ENABLED=true` en dev (Makefile `dev/engine` + `.env.example`).
  - Surface UI : page/section « Cron » listant les signals `schedule` (réutiliser
    `domains/signals/routes.ts`), création d'une tâche cron (expression + agent cible +
    input), activation/désactivation. Entrée nav `automations`/`cron` ou commande chat
    `/cron`.
- **Skills** (effort moyen) :
  - Domaine `domains/skills` (engine) : `skills` table (id, teamId, name, kind:
    `builtin|prompt|mcp`, config), `routes.ts` (list/create/update/delete),
    `repo.ts`. Les builtins (`gmail.read/send`) sont exposés en lecture seule + de
    nouveaux skills « prompt » (system-prompt nommé réutilisable) et « mcp » (alias d'un
    tool MCP).
    - **Exécution** : `domains/chat/skills.ts` (`tryBuiltinSkill`) reste pour les
      builtins ; pour les skills `prompt`, injecter le system-prompt au build du prompt
      (`buildChatPrompt`) ; pour `mcp`, mapper sur l'attache d'outil.
  - Surface UI : section « Skills » (liste + éditeur) ; attache d'un skill à un agent
    (étend `config.skills`). Commande chat `/skill`.

### Conception détaillée (skills)

```
domains/skills/
  schema (table skills) ── repo (CRUD) ── routes (/skills, /skills/:id)
        │
        ▼
  agent.config.skills: string[]  ── buildChatPrompt() injecte les skills "prompt"
        │                            tryBuiltinSkill() gère les "builtin"
        ▼
  UI: features/skills (table + éditeur) + commande chat /skill
```

1. **Migration DB** : ajouter `skills` (drizzle schema + migration PGlite/Postgres,
   cf. `infra/db/schema` + `pglite-migrate`).
2. **Repo/routes** : tenancy-scopé (`teamId`), permission `tool:write`/`settings:write`.
3. **Intégration exécution** : étendre `domains/chat/repo.ts` `buildChatPrompt` pour
   préfixer les system-prompts des skills `prompt` attachés à l'agent.
4. **UI** : `features/skills` (réutilise les patterns de `features/...tools`).

### Critères d'acceptation
- Cron : créer une tâche cron `*/5 * * * *` ciblant l'Assistant → au tick scheduler le
  signal se déclenche et un run apparaît dans `/demo/platform/runs`.
- Skills : créer un skill « prompt » et l'attacher à un agent → le system-prompt est
  effectivement injecté (vérifiable sur la réponse en chat).

### Tests
- Engine (vitest) : repo skills CRUD ; scheduler tick déclenche un signal schedule.
- E2E : créer un cron via UI, vérifier l'apparition d'un run.

### Risques
- Migration DB sur deux backends (Postgres dev / PGlite solo) → tester les deux.
- Le scheduler global multi-équipes : garder l'opt-in `SCHEDULER_ENABLED` et la
  garde par condition (déjà en place).

---

## Phase 4 — E2E ops & sim Telegram — 🏢 Platform

> La face chat de la batterie E2E (Playwright `chat.spec` + parcours conversation) est
> dans `docs/assistant-roadmap.md` § *Phase 4*.

### Objectif
Couvrir bout-en-bout la chaîne **ops** : seed → run → observabilité, et le **sim Telegram**
côté engine (dispatch inbound + capture outbound), sans bot live.

### État actuel
- Worker in-process actif (`EMBEDDED_WORKER`) → un vrai aller-retour est testable en CI
  (réponse via clé provider).
- Telegram : **simulateur officiel** `apps/engine/scripts/telegram-sim.ts`
  (`bun run sim:telegram`). Tests engine : `tests/domains/channels/telegram-sim-capture.test.ts`.
- `apps/web/e2e/nav.spec.ts` (chemins `/platform/*`).

### Périmètre
- **Sim Telegram (engine)** : `bun run sim:telegram` : inbound `/start`, message → routage
  vers l'agent bindé → capture de la réponse outbound dans `channel_deliveries` ; intégrer
  en test vitest (déjà `telegram-sim-capture.test.ts`) + un script de parcours.
- **Parcours global** : `make up` (solo) → chat → **run** → notif Telegram capturée ;
  asserter `channel_deliveries` (réponses + notifications de run) et l'apparition du run
  dans `/platform/runs`.

### Conception détaillée

```
CI (face ops):
  1. engine (EMBEDDED_WORKER=true, clé provider de test) + web
  2. seed: POST /api/v1/dev/seed   (agents + Assistant + binding Telegram)
  3. bun run sim:telegram           (inbound→agent→outbound capturé)
  4. asserter channel_deliveries (réponses + notifications de run)
  5. asserter le run dans /platform/runs (observability)
```

1. **Fixtures** : clé provider de test injectée via env (CI) ; clé dédiée CI ou mock.
2. **Telegram** : pas de bot live ; tout passe par le webhook + capture dev (le sim
   écrit les Updates au vrai endpoint, l'outbound est capturé en dev).

### Critères d'acceptation
- `bun run sim:telegram` : inbound routé vers l'agent, réponse outbound capturée.
- Parcours global vert en solo (`make up`) : run visible + delivery capturée.

### Tests / commandes
- Engine : `tests/domains/channels/*` (vitest), `bun run sim:telegram`.

### Risques
- Dépendance à une clé provider en CI → prévoir un mode mock (provider stub) si pas de clé.
- Flakiness des temporisations → assertions sur état persistant (`channel_deliveries`,
  `runs`) plutôt que sur des `sleep`.

---

## Couplage avec l'assistant

Les chantiers plateforme **consommés** par l'assistant (détaillés dans
`docs/assistant-roadmap.md`) :

| Domaine plateforme | Consommé par l'assistant | Réf. assistant |
|---|---|---|
| `domains/agents` / `domains/mcp` / `domains/channels` | Slash `/agent`, `/tool`, `/channel` + drawer Manage | Phase 3 (UI in-chat) |
| `domains/skills` (attache à l'agent) | system-prompt injecté visible en chat | Phase 3b (effet) |
| Scheduler + `domains/signals` | tâche cron → run, surfacé en chat (« mes routines ») | Phase 3b |
| Runs / observability + sim engine | parcours E2E global (chat → run → Telegram) | Phase 4 |

---

## Annexe — fichiers de référence (plateforme)

| Sujet | Fichier |
|---|---|
| Shell + sidebar plateforme | `apps/web/components/layout/{platform-shell,sidebar}.tsx` |
| Nav + routing surface-aware | `apps/web/config/nav.ts` (`hrefFor`, `PLATFORM_SEGMENTS`) |
| Runs + steps (run_messages) | `apps/engine/src/domains/runs/{routes,repo,service}.ts` |
| Worker in-process | `apps/engine/src/execution/embedded/worker.ts` |
| Adapters d'exécution | `apps/engine/src/execution/embedded/runtime/{resolve,cli,api}.ts` |
| Agents | `apps/engine/src/domains/agents/{routes,repo}.ts` |
| Tools / MCP | `apps/engine/src/domains/mcp/**`, `apps/web/lib/tools/{catalog,custom-tools}.ts` |
| Channels / Telegram | `apps/engine/src/domains/channels/**` |
| Cron / scheduler | `apps/engine/src/jobs/scheduler.ts`, `apps/engine/src/domains/signals/**` |
| Skills (builtin actuel) | `apps/engine/src/domains/chat/skills.ts` |
| Clés provider | `apps/engine/src/domains/settings/providers-repo.ts` |
| Seed (agents + Assistant + cron) | `apps/engine/src/jobs/seed-smb.ts` |
| Sim Telegram | `apps/engine/scripts/telegram-sim.ts` |
| E2E nav plateforme | `apps/web/e2e/nav.spec.ts` |
