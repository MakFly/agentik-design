# Roadmap — Surface Chat (OpenClaw-style)

Document de référence pour la suite du chantier « chat ». Chaque phase est rédigée
pour être **directement actionnable** : objectif, état réel du code, périmètre,
conception détaillée (flux + fichiers), critères d'acceptation et risques.

Convention : prose en français, identifiants/chemins/code en anglais.

---

## Contexte & état actuel (livré)

La surface chat est l'expérience assistant-ui immersive (`components/examples/base.tsx`)
embarquée dans l'`AppShell` de la plateforme, isolée visuellement mais réutilisant la
nav (`config/nav.ts` → entrée `chat`) et un bouton **New chat** en tête de sidebar.

Acquis :

- **Deux surfaces** (cf. section *Architecture* plus bas) : le **Personal Assistant**
  (chat, OpenClaw-style) à la racine `/[team]/*`, et la **plateforme Multica** sous
  `/[team]/platform/*`. Layouts dédiés via le route group `(assistant)/` et `platform/`.
- **Route chat** : `app/[team]/(app)/(assistant)/chat/{page,c/[threadId]/page,settings/page}.tsx`.
- **Historique = sessions engine persistantes** (`chat_sessions` / `chat_messages`),
  pas localStorage : `components/assistant-ui/engine-thread-history.tsx`
  (list / load / new / delete) + `qk.chat.*`.
- **Runtime** : `components/runtime/agent-task-runtime-provider.tsx` — transport
  `AssistantChatTransport` → `app/api/agent-chat/route.ts` (bridge). Le `prepareSendMessagesRequest`
  garantit/crée la session et envoie `x-session-id` (contexte multi-tours côté engine).
  La sélection d'agent est partagée via `components/runtime/agent-selection.tsx`
  (`AgentSelectionProvider`), consommée par le switcher de la sidebar **et** le runtime.
- **Streaming bout-en-bout + reasoning** *(livré)* : pour un runtime **API**, le tour
  s'exécute **in-process** et stream directement (modèle OpenClaw, pas de file `runs`) —
  `domains/chat/gateway.ts` → `POST /chat/sessions/:id/stream` →
  `streamText().toUIMessageStreamResponse({ sendReasoning })`. L'adaptateur embarqué passe
  `generateText` → **`streamText`** (reasoning par provider, `runtime/api.ts`). Fallback
  file pour CLI/daemon ou builtin skill (tail `GET /runs/:id/messages/live`,
  `runs/live-stream.ts`). Persistance = `chat_messages` ; reasoning **live-only**.
- **Rendu markdown** *(livré)* : `components/assistant-ui/markdown-text.tsx` rend le
  **math KaTeX** (remark-math + rehype-katex + `normalizeMathDelimiters`) et la
  **coloration Shiki** (`shiki-highlighter.tsx`, dual-theme) avec header de bloc
  (`code-header.tsx` : langage + copier → toast). Toasts sonner en **top-center**.
- **Exécution sans daemon** : `EMBEDDED_WORKER=true` (engine `.env` + Makefile `dev/engine`)
  → worker in-process (`execution/embedded/worker.ts`) qui exécute via CLI locale
  (`runtime/cli.ts`) ou clé provider (`runtime/api.ts`). C'est la **voie async/daemon/CLI**
  (automations, cron) ; la gateway in-process ne couvre que le *fast-path interactif*.
- **Agent par défaut** : agent généraliste **Assistant** (`runtimeKind: "openai"`, seedé
  dans `jobs/seed-smb.ts`), préféré par `AgentSelectionProvider`. Le **switcher d'agent**
  vit en tête de la sidebar assistant (`features/agent-chat/agent-switcher.tsx`, + bouton
  « + » nouvelle conversation) ; le header de chat ne montre plus qu'une présence en
  lecture seule.
- **Tests** : `apps/web/e2e/chat.spec.ts`, `apps/web/e2e/nav.spec.ts` (chemins `/platform/*`).

Données clés réutilisables pour la suite :

- Les tours d'un run sont stockés dans `run_messages` (`seq`, `type`, `tool`, `content`,
  `input`) — projetés en `Step[]` par `getRunDetail` (`domains/runs/repo.ts`) et exposés
  par `GET /api/v1/runs/:id` (`RunDetail { run, steps }`).
- Le tour assistant de chat est écrit par `appendAssistantTurn` (`domains/chat/repo.ts`)
  à la complétion du run (`onRunCompleted`, `domains/runs/service.ts`), avec un event
  realtime `chat.message`.
- assistant-ui sait déjà rendre des tool-calls : `components/assistant-ui/tool-group.tsx`,
  `tool-fallback.tsx`, `reasoning.tsx` (utilisés dans `Base` via `MessagePrimitive.GroupedParts`).

---

## Architecture — deux surfaces (livré)

L'app expose **deux produits** dans un même `app/[team]/(app)`, via des layouts distincts :

```
/[team]/(app)/layout              = session seule (SessionHydrator + SessionGuard)
  ├─ (assistant)/layout           = AssistantShell  (sidebar minimale OpenClaw)
  │     /[team]/{chat,memory,automations,channels}
  │     ▲ haut sidebar : <AgentSwitcher/> + bouton « + »  ·  bas : « Multica platform → »
  └─ platform/layout              = PlatformShell    (sidebar nav complète)
        /[team]/platform/{command-center,projects,runs,agents,tools,observability,
          runtimes,settings}       ·  haut sidebar : lien « ← Assistant »
```

- **Personal Assistant** (racine) = converser + le contexte perso de l'assistant :
  **Chat**, **Memory**, **Automations**, **Telegram**. Sidebar = `AssistantSidebar`
  (`components/layout/assistant-sidebar.tsx`), shell = `assistant-shell.tsx`.
- **Plateforme Multica** (`/platform/*`) = l'ops business : **Command Center, Projects,
  Runs, Agents, Tools, Observability, Runtimes, Settings**. Sidebar = `PlatformSidebar`
  (`sidebar.tsx`), shell = `platform-shell.tsx`.
- **Routing & liens** : `config/nav.ts` porte `surface: "assistant" | "platform"` par item ;
  `hrefFor(team, segment, rest?)` préfixe automatiquement `/platform/` pour les segments
  plateforme (`PLATFORM_SEGMENTS`). Tous les liens passent (ou doivent passer) par `hrefFor`.
- **Landing** : post-login / changement d'équipe → `/[team]/chat` (l'assistant est la
  surface primaire ; `lib/auth/post-auth.ts`, `features/session/session-guard.tsx`).

---

## Phase 2 — Tool-calls / activité dans le thread

### Objectif
Afficher dans le fil de chat les **étapes d'outils et l'activité** d'un tour (blocs
repliables `Bash`, `Gateway`, `tool_use`, reasoning…), comme la capture OpenClaw, au
lieu d'un simple texte final.

### État actuel
- **Texte + reasoning : déjà streamés** (cf. *Acquis*). Le bridge `app/api/agent-chat/route.ts`
  pipe la gateway in-process (parts `text-*` + `reasoning-*`). **Reste à faire** : les parts
  **`tool-call`** ne sont pas encore émises → c'est le cœur de cette phase.
- Pourtant la donnée existe : le run (`taskId` du tour) a ses `run_messages`
  (`type: "text" | "thinking" | "tool_use" | …`). Le worker émet déjà ces messages
  (`runtime/cli.ts` runClaude émet `text`/`thinking`/`tool_use` ; `runtime/api.ts`
  émet `text`).
- `Base` rend déjà les groupes d'outils si le flux UIMessage contient des parts
  `tool-call`/`reasoning`.

### Périmètre
- **Inclus** : streamer/rejouer les steps du run du tour courant dans le thread ;
  rendu repliable réutilisant `tool-group`/`tool-fallback`/`reasoning` ; persistance
  (au reload, l'historique réaffiche les steps).
- **Exclus** : édition d'outils, nouvelle UI de timeline (déjà couverte par run-view).

### Conception détaillée

Deux sous-chantiers : (a) **live** pendant le tour, (b) **rejeu** depuis l'historique.

```
user turn ──► bridge (/api/agent-chat) ──► engine sendChatMessage ──► run (queued)
                     │                                                     │
                     │  poll /runs/:id  ◄─── worker exécute, émit run_messages
                     ▼
   UIMessage stream:  reasoning-part(s) + tool-call-part(s) + text-part
                     │
                     ▼
        Base: MessagePrimitive.GroupedParts → ToolGroup / Reasoning / Markdown
```

1. **Backend — exposer les steps par tour**
   - Réutiliser `GET /api/v1/runs/:id` (déjà `RunDetail { run, steps }`).
   - Mapper `Step[]` → parts UIMessage : pour chaque step `tool`/`tool_use`, émettre une
     part `tool-call` (`toolName`, `args` = `input`, `result` = `content`/step result,
     `status`) ; pour `thinking`, une part `reasoning` ; le texte final reste une part
     `text`. Helper à créer : `lib/chat/run-to-parts.ts` (web) ou côté bridge.

2. **Bridge — streamer les parts au lieu du texte seul** (`app/api/agent-chat/route.ts`)
   - Pendant le poll du run, lire `run_messages` au-delà du dernier `seq` traité
     (nouvel endpoint léger `GET /api/v1/runs/:id/messages?after=<seq>` → réutiliser
     `listRunMessagesAfter` de `domains/runs/repo.ts`, déjà présent).
   - Pour chaque nouveau message : `writer.write({ type: "reasoning"|"tool-input-available"|"tool-output-available"|"text-delta", … })` selon le type (protocole AI SDK UIMessage).
   - Clôturer par le texte final + `finish`. Conserver le fallback timeout existant.

3. **Frontend — rendu** : aucun nouveau composant majeur. Vérifier le mapping de
   `MessagePrimitive.GroupedParts` (`base.tsx`, case `group-tool` / `tool-call` /
   `group-reasoning`). Ajouter au besoin un `ToolUI` par outil connu (Bash, Gateway)
   dans `components/assistant-ui/tools/` (modèle : `weather-tool-ui.tsx`).

4. **Rejeu depuis l'historique** (`engine-thread-history.tsx` → `toExternalState`)
   - Aujourd'hui on importe seulement les `chat_messages` (user/assistant texte).
   - Étendre : pour chaque message assistant ayant un `taskId`, charger `GET /runs/:taskId`
     et insérer les parts tool/reasoning **avant** la part texte dans l'external state
     (chaîne linéaire). Garder en cache (react-query) pour éviter N appels.

### Critères d'acceptation
- Un tour qui utilise des outils affiche des blocs repliables (nom d'outil + I/O +
  statut) au-dessus de la réponse, en live puis après reload.
- Un tour sans outil reste identique (texte seul), aucune régression.
- 0 erreur console ; `typecheck` + `lint` clean.

### Tests
- Unitaire : `run-to-parts` (mapping `Step`/`run_message` → parts).
- E2E Playwright : provoquer un tour avec outil (agent `Assistant` + prompt déclenchant
  un builtin, ou un agent CLI claude) → asserter la présence d'un bloc « Activity »/tool.

### Risques
- Le protocole UIMessage des tool-parts doit matcher la version d'`ai`/assistant-ui
  installée → vérifier les `type` exacts (`tool-input-available` / `tool-output-available`).
- Coût des appels `GET /runs/:id` au rejeu → cache + lazy (au scroll/expand).

---

## Phase 3 — Gestion in-chat (agents / tools / channels)

### Objectif
Pouvoir **gérer depuis le chat** (commandes `/` ou panneau latéral) ce qu'OpenClaw expose :
créer/éditer un agent, attacher des tools (MCP), lier un canal (Telegram). Sans quitter
la conversation.

### État actuel (ce qui existe déjà côté engine)
- **Agents** : domaine complet — `domains/agents/{routes,repo}.ts` (`createAgent`,
  `publishAgent`, versions, roster). Web : `features/agent-registry`, `features/agent-builder`.
- **Tools / MCP** : `domains/mcp` (+ `routes`), web `features/...tools`. Catalogue
  builtin : `lib/tools/catalog.ts`, custom tools : `lib/tools/custom-tools.ts`
  (déjà branchés dans le composer `@`-mentions de `base.tsx`).
- **Channels / Telegram** : `domains/channels/{routes,repo,service}.ts` +
  `domains/channels/telegram/*` (client, poller, dispatch, execute-command, bindings).
  Web : `features/channels`.

### Périmètre
- **Inclus** :
  - Commandes slash réelles dans le composer (`base.tsx` `slashCommands` est aujourd'hui
    un stub `console.log`) : `/agent new`, `/agent switch <name>`, `/tool add <name>`,
    `/channel bind telegram`.
  - Un panneau latéral contextuel (drawer) « Manage » réutilisant les features existantes
    (agent-builder, tools, channels) en mode embarqué.
- **Exclus** : réécrire les features ; on les **réutilise**.

### Conception détaillée

```
Composer "/" ──► slash adapter (unstable_useSlashCommandAdapter)
                         │
        ┌────────────────┼─────────────────────────┐
        ▼                ▼                          ▼
  /agent …         /tool …                     /channel …
  (agents API)     (mcp API)                   (channels API)
        └──────── ouvre un Drawer embarquant la feature concernée ────────┘
```

1. **Slash commands réels** (`components/examples/base.tsx`)
   - Remplacer les `execute: () => console.log(...)` par des actions :
     - `/agent` → ouvre le drawer Agents (création rapide via `useCreateAgent` +
       `publishAgent`) ou `setSelectedAgentId` (switch).
     - `/tool` → drawer Tools (MCP) : liste + toggle d'attache sur l'agent courant.
     - `/channel` → drawer Channels : binder l'agent courant à Telegram.
   - Source des commandes : construire dynamiquement (comme `buildMentionItems`).

2. **Drawer « Manage »** (`features/chat/manage-drawer.tsx`, nouveau)
   - `Sheet`/`Drawer` (déjà dans `components/ui`).
   - Onglets : Agent (réutilise `agent-builder` en variante compacte), Tools (réutilise
     la table MCP), Channel (réutilise `features/channels` binding form).
   - Toutes les écritures passent par les hooks/API existants → **zéro nouveau backend**.

3. **Création d'agent in-chat → utilisable immédiatement**
   - Après `publishAgent`, invalider `qk.agents.*` ; l'agent apparaît dans le sélecteur
     du header et devient sélectionnable pour le tour suivant.

4. **Lien canal Telegram**
   - Form de binding (channel → agent) via `domains/channels` (`POST /channels/:id/bindings`
     ou équivalent). Vérifier le schéma dans `domains/channels/schemas.ts`.

### Critères d'acceptation
- `/agent new "Nom"` crée un agent publié, visible dans `/demo/agents` et dans le
  sélecteur du chat.
- `/tool add <name>` attache un outil à l'agent courant (vérifiable dans le builder).
- `/channel bind telegram` crée un binding (vérifiable dans `/demo/channels`).
- Aucune régression de la conversation pendant l'usage du drawer.

### Tests
- E2E : ouvrir le chat, exécuter `/agent new`, asserter l'agent dans le sélecteur ;
  `/channel bind telegram`, asserter le binding via l'API.

### Risques
- Surface large : livrer **incrémentalement** (agents d'abord, puis tools, puis channels).
- Cohérence des permissions RBAC (`agent:write`, `tool:write`, `settings:write`).

---

## Phase 3b — Skills & Cron

### Objectif
Donner une **gestion réelle des skills** et des **tâches cron** accessibles (et idéalement
pilotables depuis le chat), à parité avec OpenClaw (sections « Skills » et « Tâches cron »).

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
  signal se déclenche et un run apparaît dans `/demo/runs`.
- Skills : créer un skill « prompt » et l'attacher à un agent → le system-prompt est
  effectivement injecté (vérifiable sur la réponse).

### Tests
- Engine (vitest) : repo skills CRUD ; scheduler tick déclenche un signal schedule.
- E2E : créer un cron via UI, vérifier l'apparition d'un run.

### Risques
- Migration DB sur deux backends (Postgres dev / PGlite solo) → tester les deux.
- Le scheduler global multi-équipes : garder l'opt-in `SCHEDULER_ENABLED` et la
  garde par condition (déjà en place).

---

## Phase 4 — Tests E2E (Playwright chat + Telegram sim)

### Objectif
Batterie de tests bout-en-bout couvrant le chat **et** Telegram, exécutable en local
sans bot live.

### État actuel
- `apps/web/e2e/chat.spec.ts` (rendu, rail, repli, nav).
- Telegram : **simulateur officiel** `apps/engine/scripts/telegram-sim.ts`
  (`bun run sim:telegram`) — exerce le vrai dispatch inbound + capture outbound, sans
  token live (idéal CI). Tests engine : `tests/domains/channels/telegram-sim-capture.test.ts`.
- Worker in-process actif (`EMBEDDED_WORKER`) → un vrai aller-retour de chat est
  testable en CI (réponse via clé provider).

### Périmètre
- **Chat (Playwright)** — étendre `e2e/chat.spec.ts` :
  - Envoi → réponse réelle (worker + clé provider de test) : asserter un texte assistant.
  - Multi-tours : 2e message dépend du 1er (contexte) → asserter la cohérence.
  - Persistance : reload de `/chat/c/:id` → l'historique réaffiche les tours.
  - Création de session : `New chat` → nouvelle session listée dans la rail.
  - Tool-calls (dépend Phase 2) : présence d'un bloc activité sur un tour à outil.
- **Telegram (sim)** — script + assertions :
  - `bun run sim:telegram` : inbound `/start`, message → routage vers l'agent bindé →
    capture de la réponse outbound dans `channel_deliveries`.
  - Intégrer en test vitest (déjà `telegram-sim-capture.test.ts`) + un script de parcours.
- **Parcours global** : `make up` (solo) → chat → run → notif Telegram capturée.

### Conception détaillée

```
CI:
  1. engine (EMBEDDED_WORKER=true, clé provider de test) + web
  2. seed: POST /api/v1/dev/seed   (agents + Assistant + binding Telegram)
  3. playwright: e2e/chat.spec.ts   (envoi/réponse/persistance/sessions)
  4. bun run sim:telegram           (inbound→agent→outbound capturé)
  5. asserter channel_deliveries (réponses + notifications de run)
```

1. **Fixtures** : clé provider de test injectée via env (CI) ; éviter d'exposer une vraie
   clé — utiliser une clé dédiée CI ou un provider mock.
2. **Stabilité** : `browser_wait_for(text)` avec timeout généreux (le worker poll 1s,
   le bridge poll 1.5s) ; idempotence du seed.
3. **Telegram** : pas de bot live ; tout passe par le webhook + capture dev (le sim
   écrit les Updates au vrai endpoint, l'outbound est capturé en dev).

### Critères d'acceptation
- `bun run test:e2e:pw` vert (chat : envoi/réponse, multi-tours, persistance, sessions).
- `bun run sim:telegram` : inbound routé vers l'agent, réponse outbound capturée.
- Parcours global vert en solo (`make up`).

### Tests / commandes
- Web : `apps/web/e2e/chat.spec.ts` (Playwright), `bun run test:e2e:pw`.
- Engine : `tests/domains/channels/*` (vitest), `bun run sim:telegram`.

### Risques
- Dépendance à une clé provider en CI → prévoir un mode mock (provider stub) si pas de
  clé disponible.
- Flakiness des temporisations → préférer `wait_for(text)` à des `sleep` fixes.

---

## Annexe — fichiers de référence

| Sujet | Fichier |
|---|---|
| Surface chat (assistant-ui) | `apps/web/components/examples/base.tsx` |
| Wrapper + header agent | `apps/web/features/agent-chat/agent-chat-screen.tsx` |
| Historique engine | `apps/web/components/assistant-ui/engine-thread-history.tsx` |
| Runtime + transport (x-session-id) | `apps/web/components/runtime/agent-task-runtime-provider.tsx` |
| Bridge chat | `apps/web/app/api/agent-chat/route.ts` |
| Chat domain (sessions/messages) | `apps/engine/src/domains/chat/{routes,repo,skills}.ts` |
| Runs + steps (run_messages) | `apps/engine/src/domains/runs/{routes,repo,service}.ts` |
| Worker in-process | `apps/engine/src/execution/embedded/worker.ts` |
| Adapters d'exécution | `apps/engine/src/execution/embedded/runtime/{resolve,cli,api}.ts` |
| Clés provider | `apps/engine/src/domains/settings/providers-repo.ts` |
| Channels / Telegram | `apps/engine/src/domains/channels/**` |
| Cron / scheduler | `apps/engine/src/jobs/scheduler.ts`, `apps/engine/src/domains/signals/**` |
| Seed (agents + Assistant) | `apps/engine/src/jobs/seed-smb.ts` |
| Sim Telegram | `apps/engine/scripts/telegram-sim.ts` |
| E2E chat | `apps/web/e2e/chat.spec.ts` |
