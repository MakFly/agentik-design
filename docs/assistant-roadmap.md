# Roadmap — Personal Assistant (IA perso, OpenClaw-style) 🗣️

Document de référence pour la surface **Personal Assistant** : l'expérience de chat
immersive à la racine `/[team]/*` (Chat, Memory, Automations, Telegram). Chaque phase est
rédigée pour être **directement actionnable** : objectif, état réel du code, périmètre,
conception détaillée (flux + fichiers), critères d'acceptation et risques.

Deux produits servent de **référence** pour ce que doit faire un assistant perso réel —
la section *Modèle de référence* ci-dessous les reprend et les mappe sur notre surface :

- **OpenClaw** (`github.com/openclaw/openclaw`) — assistant perso local-first, *control plane*
  **Gateway** (sessions/channels/tools/events) exposé en **WebSocket + token**
  (`openclaw gateway run` / `openclaw dashboard` — vérifié sur l'instance locale
  `http://localhost:18789`, page « Tableau de bord Gateway »). Multi-canal (Telegram en
  premier), `SOUL.md`/`AGENTS.md`/`TOOLS.md`, skills (ClawHub), cron, canvas, voix.
- **Hermes Agent** (`github.com/NousResearch/hermes-agent`, « hermes » CLI) — assistant
  *self-improving* : **CLI/TUI** (slash autocomplete, history, **interrupt-and-redirect**,
  **streaming tool output**), **gateway** messagerie unique multi-canal, skills procéduraux
  auto-créés (std agentskills.io), **memory** (user-modeling + session search résumée),
  cron avec delivery vers n'importe quel canal, model-agnostic (`/model`).

> Pendant produit pour l'ops/plateforme : voir **`docs/platform-roadmap.md`** (Multica).
> Les items qui couplent les deux surfaces sont signalés et détaillés dans la section
> *Couplage avec la plateforme* en bas de ce document.

Convention : prose en français, identifiants/chemins/code en anglais.

---

## Modèle de référence — OpenClaw + Hermes (mappé sur notre surface)

Ce que font réellement les deux références, et notre état **vérifié dans le code** (pour ne
pas survendre) :

| Concept de référence (OpenClaw / Hermes) | Notre surface aujourd'hui (vérifié) | Écart / réf. |
|---|---|---|
| **Gateway = control plane** (sessions/channels/tools/events) via WS+token ; Hermes = 1 process multi-canal | Bridge `/api/agent-chat` + engine ; **homonyme trompeur** : notre `domains/chat/gateway.ts` est un *fast-path streaming in-process*, **pas** un control plane WS | Pas de gateway WS unifié. Multi-canal = `domains/channels`. |
| **Multi-canal** (Telegram, Discord, Slack, WhatsApp, Signal, email…) + continuité cross-canal | **Telegram seul** (`domains/channels/telegram/*`) | Autres canaux = backlog (cf. *Pistes*). |
| **Personnalité** : `SOUL.md` (perso) · `AGENTS.md` (routing) · `TOOLS.md` | `agent.instructions` / `config.systemPrompt` (`domains/agents/repo.ts:173`) | SOUL.md → l'éditeur d'instructions d'agent ; pas de fichier dédié. |
| **Memory** : durable memory *agent-curated* + **session search/recall** (résumé LLM) + **injection au prompt** | **LIVRÉ** : UI `features/memory/*` + backend `domains/learning/memory/*` (tables `memory_entries`/`memory_events`, routes `/memory*`, `injection-preview`, `session-search`). **Injection réelle** au prompt via `buildInjectionPreamble` (gateway in-process **et** daemon `execution/daemon/repo.ts`). Vérifié par `scripts/assistant-cases.ts` (cas 3). | 🟡 **partiel** vs réf. : notre mémoire est réelle mais **plus simple** — pas de providers pluggables (mem0/honcho), pas de réflexion REM/DREAMS scorée, recall sans FTS5 multi-modes. Le « Phase 5 » ci-dessous est obsolète. |
| **Skills** : procéduraux, **auto-créés/auto-améliorés** (Hermes `background_review` ; OpenClaw `skill-workshop` propose/apply), std agentskills.io ; registre (ClawHub) | builtins + `config.skills` injectés ; **boucle d'auto-amélioration LIVRÉE** : reviewer **LLM** (`reviews/llm-agent.ts`, `generateObject`) gaté post-tour → propositions skill create/patch + mémoires → **approbation humaine** dans `/skills` (`/run-reviews/:id/approve` → `applyRunReview` versionne) | 🟡 **partiel** : boucle réelle sur le chemin **daemon/builtin** ; les tours **gateway** (Assistant par défaut) ne sont **pas encore** reviewés (couplé à la persistance des steps, Phase 2). Pas de registre type ClawHub. |
| **Cron** : tâches programmées avec delivery vers n'importe quel canal | `domains/signals` (kind `schedule`) + **UI `features/automations`** (signals/rules/deliveries) déjà en **assistant** | Backend OK ; *décision de périmètre* assistant↔plateforme. |
| **CLI/TUI Hermes** : slash autocomplete · history · **interrupt-and-redirect** · **streaming tool output** | Composer `base.tsx` : streaming **texte+reasoning OK** ; **slash réels LIVRÉS** (`/new`, `/summarize`, `/translate`, `/inbox`, `/model`, `/help` — `useSlashCommands`, `removeOnExecute`) ; **tool-output dans le thread** : le chemin **gateway** stream désormais de vrais `tool_use` (web tools) → parts rendues live ; le chemin Gmail `fulfillGmailWithTools` les jette encore (1 part texte) | slash = ✅ ; tool-output = ✅ gateway / RAF persistance+Gmail ; interrupt-and-redirect = RAF. |
| **Tools** : 40+, web/search/code-exec, backends terminal (local/Docker/SSH/Modal/Daytona) | `domains/mcp` + builtins + runtimes/exec backends ; **web tools LIVRÉS** façon Hermes (`web-tools.ts` : `web_search` Tavily/Brave/**DuckDuckGo keyless** + `web_extract` SSRF-gardé), branchés gateway + Gmail | 🟡 web + Gmail + MCP livrés ; pas de calendar/computer-use/média. Reste = plateforme. |
| **Cross-session tools** (`sessions_list/history/send`) | sessions persistantes (`chat_sessions`) sans outils inter-sessions | Piste long terme. |
| **Canvas** (Live Canvas / A2UI) · **Voice** (wake/talk) | — | Pistes long terme. |
| **Model-agnostic** (`/model` switch) | multi-provider (`settings/providers-repo.ts`), `runtimeKind` par agent ; **`/model` LIVRÉ** : slash (`base.tsx`, cycle + localStorage) **et** le `ModelPicker` du composer câblés → override par tour (`body.model`/`config.modelName` → gateway, garde cross-provider `providerOfModel`) | ✅ override sur le chemin **gateway** (Assistant). N'affecte pas le chemin daemon/builtin. |

---

## Contexte & état actuel (livré)

La surface chat est l'expérience assistant-ui immersive (`components/examples/base.tsx`)
embarquée dans l'`AppShell`, isolée visuellement mais réutilisant la nav
(`config/nav.ts` → entrée `chat`) et un bouton **New chat** en tête de sidebar.

Acquis :

- **Deux surfaces** (cf. section *Architecture*) : le **Personal Assistant** (chat,
  OpenClaw-style) à la racine `/[team]/*`, et la **plateforme Multica** sous
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

## Architecture — la surface assistant (livré)

L'app expose **deux produits** dans un même `app/[team]/(app)`, via des layouts distincts.
Vue d'ensemble (la surface assistant est la branche `(assistant)/`) :

```
/[team]/(app)/layout              = session seule (SessionHydrator + SessionGuard)
  ├─ (assistant)/layout           = AssistantShell  (sidebar minimale OpenClaw)   ◄── CE DOC
  │     /[team]/{chat,memory,automations,channels}
  │     ▲ haut sidebar : <AgentSwitcher/> + bouton « + »  ·  bas : « Multica platform → »
  └─ platform/layout              = PlatformShell    (sidebar nav complète)        → platform-roadmap.md
        /[team]/platform/{command-center,projects,runs,agents,tools,observability,
          runtimes,settings}       ·  haut sidebar : lien « ← Assistant »
```

- **Personal Assistant** (racine) = converser + le contexte perso de l'assistant :
  **Chat**, **Memory**, **Automations**, **Telegram**. Sidebar = `AssistantSidebar`
  (`components/layout/assistant-sidebar.tsx`), shell = `assistant-shell.tsx`.
- **Routing & liens** : `config/nav.ts` porte `surface: "assistant" | "platform"` par item ;
  `hrefFor(team, segment, rest?)` préfixe automatiquement `/platform/` pour les segments
  plateforme (`PLATFORM_SEGMENTS`). Tous les liens passent (ou doivent passer) par `hrefFor`.
- **Landing** : post-login / changement d'équipe → `/[team]/chat` (l'assistant est la
  surface primaire ; `lib/auth/post-auth.ts`, `features/session/session-guard.tsx`).

---

## RAF — Reste à faire (assistant) 🗣️

> ✅ **Mises à jour vérifiées (2026-06-30)** — voir la section *Vérifié bout-en-bout* en bas :
> **Memory backend** et **slash commands réels** sont **livrés** (les deux lignes barrées
> ci-dessous étaient obsolètes). Restent surtout : tool-output dans le thread, interrupt-and-redirect.

| Item | Réf. | Ce que ça implique |
|---|---|---|
| ~~**Memory — backend manquant**~~ ✅ **FAIT** | Phase 5 | Backend **présent** dans `domains/learning/memory/*` (pas un `domains/memory` séparé) : CRUD `/memory*`, `injection-preview`, `session-search`, **injection réelle au prompt** (gateway + daemon). Vérifié (cas 3). |
| **Tool-calls / activité dans le thread** | Phase 2 | Étendre la **gateway** (`domains/chat/gateway.ts`) pour émettre des parts `tool-call` (aujourd'hui seulement `text`+`reasoning`) **et** le rejeu depuis l'historique. = *streaming tool output* Hermes. *Note : `fulfillGmailWithTools` (`skills.ts`) exécute déjà de **vrais** `tool_use` (`gmail_read`/`gmail_send` via `stopWhen stepCountIs(6)`) mais les **jette** — un seul `run_message` texte final est persisté. Le tool-output est donc activement supprimé, pas absent faute d'émetteur ; il faut l'exposer, pas seulement « attendre un runtime ».* |
| ~~**Slash commands réels**~~ ✅ **FAIT** | Phase 3 | Stubs `console.log` remplacés par de vrais slash (`base.tsx` `useSlashCommands` + `removeOnExecute`) : `/new` (reset thread), `/summarize`, `/translate`, `/inbox` (skill Gmail), `/help` (toast). `/agent`/`/model`/`/tool`/`/channel` (mutations plateforme) = RAF. |
| **Composer « Hermes-grade »** | Phase 3 | Au-delà des slash : **interrupt-and-redirect** (stop le tour en cours + reprise avec nouvelle consigne) et autocomplete riche, comme la TUI Hermes. Aujourd'hui absent. |
| **Personnalité d'agent (modèle SOUL.md)** | — | Mapper l'éditeur d'`instructions`/`systemPrompt` (déjà en base, `domains/agents/repo.ts`) sur le modèle **SOUL.md** (persona réutilisable) plutôt qu'un champ texte brut. |
| **Header des pages secondaires** (Memory/Automations/Telegram) | — | Elles tournent dans `AssistantShell` avec la **topbar plateforme** → leur donner un header assistant propre (ou retirer la topbar sur ces pages). |
| **Sidebar assistant responsive / mobile** | — | Pas de nav mobile dédiée assistant (`MOBILE_NAV_KEYS` est devenu mort après le split). |

### Décisions de périmètre à trancher (impactent l'assistant)
- **Automations / Cron** : la *gestion* des tâches cron vit côté **assistant** (« mes
  routines ») ou **plateforme** (ops, près des Runs) ? Aujourd'hui *Automations* est en
  assistant mais le backend cron est de l'ops — incohérence à lever. *(Détail Cron côté
  plateforme : `docs/platform-roadmap.md` § Phase 3b.)*
- **Memory / Telegram** : confirmés côté **assistant** (contexte perso) ou plutôt **admin
  plateforme** ? Le split actuel les met en assistant.

---

## Phase 2 — Tool-calls / activité dans le thread — 🗣️ Assistant

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

## Phase 3 — Gestion in-chat (UI) — 🗣️ Assistant (couple la plateforme)

> **Couplage** : l'UI vit dans le chat (ce doc), mais elle pilote des **domaines
> plateforme** (agents / tools / channels). La face backend est décrite dans
> `docs/platform-roadmap.md` § *Phase 3 — Domaines pilotés in-chat*.

### Objectif
Pouvoir **gérer depuis le chat** (commandes `/` ou panneau latéral) ce qu'OpenClaw expose :
créer/éditer un agent, attacher des tools (MCP), lier un canal (Telegram). Sans quitter
la conversation.

### État actuel (côté UI chat)
- Le composer `@`-mentions branche déjà le catalogue d'outils (`buildMentionItems`,
  `lib/tools/catalog.ts`, `lib/tools/custom-tools.ts`).
- `base.tsx` `slashCommands` est aujourd'hui un **stub** `console.log`.
- Les features réutilisables existent : `features/agent-registry`, `features/agent-builder`,
  `features/...tools`, `features/channels`.

### Périmètre
- **Inclus (UI assistant)** :
  - Commandes slash réelles dans le composer : `/agent new`, `/agent switch <name>`,
    `/tool add <name>`, `/channel bind telegram`.
  - Un panneau latéral contextuel (drawer) « Manage » réutilisant les features existantes
    (agent-builder, tools, channels) en mode embarqué.
- **Exclus** : réécrire les features ou les APIs ; on les **réutilise** (cf. plateforme).

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
- `/agent new "Nom"` crée un agent publié, visible dans `/demo/platform/agents` et dans le
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

## Phase 4 — Tests E2E (chat + Telegram) — 🗣️ Assistant

> La face ops de la batterie E2E (runs / observability + sim engine) est dans
> `docs/platform-roadmap.md` § *Phase 4 — E2E ops & sim Telegram*.

### Objectif
Couvrir bout-en-bout le **chat** et le canal **Telegram** (surface assistant),
exécutable en local sans bot live.

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

### Conception détaillée

```
CI (face assistant):
  1. engine (EMBEDDED_WORKER=true, clé provider de test) + web
  2. seed: POST /api/v1/dev/seed   (agents + Assistant + binding Telegram)
  3. playwright: e2e/chat.spec.ts   (envoi/réponse/persistance/sessions)
  4. bun run sim:telegram           (inbound→agent→outbound capturé)
```

1. **Fixtures** : clé provider de test injectée via env (CI) ; éviter d'exposer une vraie
   clé — utiliser une clé dédiée CI ou un provider mock.
2. **Stabilité** : `browser_wait_for(text)` avec timeout généreux (le worker poll 1s,
   le bridge poll 1.5s) ; idempotence du seed.
3. **Telegram** : pas de bot live ; tout passe par le webhook + capture dev.

### Critères d'acceptation
- `bun run test:e2e:pw` vert (chat : envoi/réponse, multi-tours, persistance, sessions).
- `bun run sim:telegram` : inbound routé vers l'agent, réponse outbound capturée.

### Tests / commandes
- Web : `apps/web/e2e/chat.spec.ts` (Playwright), `bun run test:e2e:pw`.
- Engine : `tests/domains/channels/*` (vitest), `bun run sim:telegram`.

### Risques
- Dépendance à une clé provider en CI → prévoir un mode mock (provider stub) si pas de
  clé disponible.
- Flakiness des temporisations → préférer `wait_for(text)` à des `sleep` fixes.

---

## Phase 5 — Memory (domaine engine) — 🗣️ Assistant

### Objectif
Implémenter le backend `domains/memory` que le cockpit `features/memory` **appelle déjà**,
à parité avec le modèle **« agent-curated memory + session recall »** d'OpenClaw/Hermes :
durable memory injectée au prompt + rappel des conversations passées.

### État actuel — UI livrée, backend absent
- **UI livrée** : page `/[team]/memory` → `features/memory/memory-cockpit.tsx`
  (durable facts/preferences/constraints/operating rules, **scope** `team|agent`, **source**,
  recherche, restore) + `features/memory/api.ts`.
- **Backend ABSENT** : `api.ts` tape `/memory`, `/memory/:id`, `/memory/events`,
  `/memory/injection-preview`, `/memory/session-search` mais il n'existe **aucun**
  `domains/memory` côté engine (domaines présents : agents, channels, chat, credentials,
  learning, mcp, projects, runs, settings, signals). → **le cockpit est branché dans le vide.**

### Périmètre
- **Domaine `domains/memory`** : table `memory_entries` (id, teamId, agentId?, scope, source
  `manual|agent|recall`, content, status `active|archived`, timestamps) + `memory_events`
  (audit). Routes : list (filtres `apiFilters`), create, patch, delete, restore, events —
  **contrat = le `api.ts` existant** (ne pas redéfinir l'UI).
- **Injection au prompt** : `injection-preview` (déjà appelé par agent) + branchement **réel**
  dans `buildChatPrompt` (`domains/chat/repo.ts`) — préfixer les durable memories actives
  (scope team + agent courant) au system prompt, sur le même modèle que les skills `prompt`.
- **Session recall** : `session-search` = recherche sur `chat_messages` passés (résumé LLM
  optionnel façon Hermes) → renvoie des `SessionRecallHit[]` rappelables.
- **(Option, parité réf.)** *agent-curated* : à `onRunCompleted`, laisser l'agent proposer
  des durable facts (source `agent`) — backlog.

### Conception détaillée

```
features/memory (UI livrée)  ──►  domains/memory (À CRÉER)
   cockpit + api.ts                 memory_entries / memory_events
        │                                   │
        │  /memory, /injection-preview,     ├─ list/create/patch/delete/restore/events
        │  /session-search                  ├─ injection-preview ─┐
        ▼                                   └─ session-search     │
   buildChatPrompt() (domains/chat/repo.ts) ◄──── injecte durable memories actives ┘
```

### Critères d'acceptation
- `/[team]/memory` liste/crée/édite des entrées réelles (**plus de 404 sur `/memory*`**).
- `injection-preview` reflète **exactement** ce que `buildChatPrompt` injecte.
- Une durable memory active influe sur une réponse de chat (vérifiable bout-en-bout).

### Tests
- Engine (vitest) : repo memory CRUD + filtres ; `session-search` sur un jeu de `chat_messages`.
- E2E : écrire un fact dans le cockpit → poser une question en chat → la réponse en tient compte.

### Risques
- Migration DB deux backends (Postgres dev / PGlite solo).
- Coût/latence de l'injection → borner par scope + nombre d'entrées + cache.

---

## Pistes long terme — parité OpenClaw / Hermes (exploratoire)

Hors phases planifiées : ce que les références font et que nous n'avons pas, à arbitrer.

- **Multi-canal** (Discord, Slack, WhatsApp, Signal, email) + continuité cross-canal →
  extension `domains/channels` (aujourd'hui Telegram seul). *Surface plateforme.*
- **Cross-session tools** (`sessions_list` / `sessions_history` / `sessions_send`) : laisser
  l'agent lire/écrire entre conversations.
- **Skills auto-améliorants** (création procédurale, std agentskills.io) au-delà du CRUD
  plateforme (Phase 3b) : boucle d'auto-amélioration Hermes.
- **Canvas** (Live Canvas / A2UI OpenClaw) : surface visuelle pilotée par l'agent dans le thread.
- **Voice** (wake word / talk mode, TTS/STT).
- **Interrupt-and-redirect** dans le composer (cf. RAF Phase 3) et **`/model` switch** in-chat.

---

## Couplage avec la plateforme

Les chantiers assistant qui **consomment** des domaines plateforme (détaillés dans
`docs/platform-roadmap.md`) :

| Depuis l'assistant | Vers la plateforme | Réf. plateforme |
|---|---|---|
| Slash `/agent`, `/tool`, `/channel` + drawer Manage | APIs `domains/agents`, `domains/mcp`, `domains/channels` | Phase 3 (domaines pilotés in-chat) |
| Effet d'un **skill** attaché (system-prompt injecté en chat) | Domaine `domains/skills` + attache à l'agent | Phase 3b |
| Tâche cron qui produit un run visible | Scheduler + `domains/signals` + `/runs` | Phase 3b · Phase 4 |
| Parcours E2E global (chat → run → notif Telegram) | Runs / observability + sim engine | Phase 4 |

---

## Vérifié bout-en-bout (2026-06-30) ✅

Cinq cas concrets **réels** exécutés contre l'engine live (mêmes routes HTTP que le chat
web) prouvent que la surface est un vrai assistant perso, pas une coquille de démo.
Script reproductible : **`apps/engine/scripts/assistant-cases.ts`** (`bun run
apps/engine/scripts/assistant-cases.ts`, **5/5 PASS**). Ces 5 cas sont **spécifiques à ce
script** — à ne pas confondre avec la suite engine complète (`bun test`), désormais
**215/215 PASS** après correction d'un test `seed-smb` resté figé à 4 agents alors que le
seed en provisionne 5 (ajout de l'agent « Assistant »).

| # | Cas | Ce qu'il prouve | Preuve |
|---|---|---|---|
| 1 | **Chat streaming** | Tour LLM réel streamé in-process (gateway, clé OpenAI) | réponse `PONG` |
| 2 | **Contexte multi-tours** | Un follow-up résout contre les tours précédents | « Lyon » rappelé |
| 3 | **Mémoire durable injectée** | Un fait *agent-curated* change une réponse en **session vierge** | codeword injecté ressorti |
| 4 | **Skill builtin Gmail-send** | Outil déterministe → **email réellement livré** (fallback Mailpit) | message présent dans Mailpit |
| 5 | **Boucle canal Telegram** | Update inbound → agent bindé → **delivery outbound** | `channel_deliveries` peuplé |

Côté UI (vérifié via Playwright sur `/demo/chat`) : streaming + reasoning, **slash réels**
(`/new`, `/summarize`, `/translate`, `/inbox`, `/help`), historique de sessions persistant,
0 erreur console. La mémoire/persona injectée transparaît jusque dans les réponses du chat.

---

## Annexe — fichiers de référence (assistant)

| Sujet | Fichier |
|---|---|
| Surface chat (assistant-ui) | `apps/web/components/examples/base.tsx` |
| Wrapper + header agent | `apps/web/features/agent-chat/agent-chat-screen.tsx` |
| Switcher d'agent (sidebar) | `apps/web/features/agent-chat/agent-switcher.tsx` |
| Historique engine | `apps/web/components/assistant-ui/engine-thread-history.tsx` |
| Runtime + transport (x-session-id) | `apps/web/components/runtime/agent-task-runtime-provider.tsx` |
| Sélection d'agent partagée | `apps/web/components/runtime/agent-selection.tsx` |
| Bridge chat | `apps/web/app/api/agent-chat/route.ts` |
| Shell + sidebar assistant | `apps/web/components/layout/{assistant-shell,assistant-sidebar}.tsx` |
| Rendu markdown / code | `apps/web/components/assistant-ui/{markdown-text,shiki-highlighter,code-header}.tsx` |
| Chat domain (sessions/messages/gateway) | `apps/engine/src/domains/chat/{routes,repo,skills,gateway}.ts` |
| Memory — UI livrée (backend à créer) | `apps/web/features/memory/{memory-cockpit,api}.tsx` |
| Automations — UI (sur `domains/signals`) | `apps/web/features/automations/*`, page `(assistant)/automations` |
| Personnalité d'agent (instructions/systemPrompt) | `apps/engine/src/domains/agents/repo.ts` |
| E2E chat | `apps/web/e2e/chat.spec.ts` |
| Sim Telegram | `apps/engine/scripts/telegram-sim.ts` |
| 5 cas de preuve (live) | `apps/engine/scripts/assistant-cases.ts` (`bun run sim:cases`) |
| Slash commands réels | `apps/web/components/examples/base.tsx` (`useSlashCommands`) |
| Injection mémoire au prompt | `apps/engine/src/domains/learning/memory/injection.ts` |
