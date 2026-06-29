Toutes les corrections du critique sont confirmées sur le code réel (multica = 18 fichiers source dont `hermes.go`/`hub.ts`/`_shared.ts`/onboarding ; `control.ts:23-37` WS sans RBAC ; `runs/service.ts` écrit `agents` l.170/222 + `runs` l.276/321 + `projectTasks` l.358/398 ; les 3 routes workflows redirigent vers command-center). Voici la review finale.

# Review CTO — Agentik (état vs cible)

---

## 0. Journal d'exécution — décisions du fondateur & Phase 0 (2026-06-29)

**Décisions du fondateur (résolution du §7) :**

| # | Sujet | Décision | Statut |
|---|---|---|---|
| 1 | Route `/chat` isolée | **Tuer** | ✅ Fait — route supprimée. Bridge daemon (`/api/agent-chat` + `agent-task-runtime-provider`) **conservé** et marqué `RESERVED (Phase 4)` pour ré-emploi dans la console Projet/Agent (sortie de migration nommée, autorisée par la règle dead-code) |
| 2 | `workflow-builder` | **Garder** (pour + tard) | ✅ Intact — `features/workflow-builder/`, `packages/workflow-engine/`, worker, routes inchangés |
| 3 | hermes runtime par défaut | **Tester après** le bloc sécurité Phase 1 | ⏳ Non démarré (dépend de Phase 1) |
| 4 | Rôle de Multica | **Reco CTO : code-name public d'Agentik** (désentrelacement non rentable, 1 produit = 1 nom) → ADR à écrire | ⏳ ADR à rédiger (P1, non bloquant) |
| 5 | Routes hors-scope | **Supprimer** (MVP strict) | ✅ Partiel — voir ci-dessous |

**Décision #5 — raffinée à l'exécution (preuve-sourcée) :**

- ✅ **Supprimés** (vrais stubs non câblés) : route `/evals` ; route `/skills` + `features/configure/skills-page.tsx`.
- ⛔ **Reclassé KEEP — `runtimes`** : `features/runtimes/` n'est **pas** un stub. Ses fichiers infra (`local-daemon-api`, `daemon-view`, `types`) sont consommés par `components/layout/daemon-status.tsx` (indicateur daemon du topbar, toujours visible) et `features/agent-builder`. Suppression annulée → route + feature + nav **conservées**. Seul le mort confirmé `features/settings/tabs/runtimes-tab.tsx` (+test, inaccessible) a été supprimé.
- ⛔ **Reclassé KEEP — `memory`, `observability`, `reviews`** : câblés dans des surfaces cœur (`agent-detail-screen` → `/memory` ; `run-summary` → `/observability/traces`) **et** alignés north-star (Memory = concept central ; traces = « Runs observables »). Les supprimer = régression, pas nettoyage. À **ré-intégrer** dans Projects/Runs plus tard, pas à supprimer. **→ à confirmer par le fondateur** (override possible).

**Dead code supprimé (Phase 0, zéro-risque, prouvé inutilisé) :** `demo-runtime-provider.tsx`, `tools-registrar.tsx`, `app/api/chat/route.ts`, `features/runs-list/runs-table.tsx`, `runtimes-tab.tsx`(+test), `components/landing/multica-onboarding.tsx`.

**Daemon installer (hors plan, débloqué) :** `scripts/install.sh` ne téléchargeait qu'un binaire d'une release GitHub inexistante (`agentik-ai/agentik` → 404) → l'installeur in-app échouait en silence. Corrigé : fallback `AGENTIK_CLI_PATH → release → build source` (commit `4dae08c`). Binaire `agentik` rebuildé depuis les sources et installé dans `~/.local/bin`.

**Phase 1 — bloc sécurité P0 : ✅ FAIT** (3/3 sous-tâches, testées, commitées)
- ✅ **RBAC sur le canal WS** (`9a29c3f`) : `WsData` porte désormais `userId`+`role` (résolus server-side à l'upgrade) ; `handleControl` gate chaque action sur la même matrice que les routes HTTP via `roleCan` (cancel/pause/resume → `run:control`, approve/reject → `run:approve`). Refus → `{accepted:false, reason:"forbidden"}`, l'action ne tourne pas. Test deny-path 6 cas (DB-free).
- ✅ **Pause forte** (`79beaef`) : `appendMessages` renvoie `cancel:true` aussi sur `paused` → le daemon SIGTERM le CLI en vol (même chemin que cancel) ; le `Fail` qui suit est absorbé (failTask ne transitionne que queued/running) → le run reste `paused` et resumable. `resumeRun` ré-arme le dispatch (clear runtime/daemon/dispatchedAt). Test DB-backed 3 cas. **Aucun changement Go nécessaire.**
- ✅ **Bouton Resume** (`baf4f46`) : affiché sur les runs `paused` (l'engine le supportait déjà).

**Retest complet (tout vert) :** web `tsc` ✅ · engine `tsc` ✅ · engine `bun test` ✅ **208/0** · daemon `go build`+`go vet` ✅ · daemon `go test` ✅ (les 2 tests pré-existants couplés à l'environnement rendus auto-skip, commit `887b70c`, alignés sur la discipline "auto-skip si dépendance absente").

**Phase 2 — recentrer sur Projects : ✅ FAIT** (`634840e`) : Projects en 1er dans la nav (desktop + mobile). /chat isolé déjà supprimé (P0) ; la `ProjectConsole` existante (thread + instruction de run) EST la surface conversationnelle scopée à la tâche → north-star respecté sans page chat séparée.

**Phase 3 — conformité archi + ledger : ✅ FAIT**
- ✅ Conformité (`b909ff8`) : écritures cross-domaine `projectTasks` sorties de `runs/service.ts` → helpers `markProjectTaskReview/Blocked` via le barrel projects (invariant #2) ; deep import `learning/memory/repo` → barrel (invariant #3). *(Reste : relocaliser `publishAgent` hors de runs/service — suivi.)*
- ✅ Ledger step (a) (`0920ff3`) : `backfillRunEvents(runId)` idempotent qui reconstruit `run_events` depuis `run_messages` (mapping dual-write partagé) + script one-off. **Step (b) — bascule SSE — NON faite délibérément** : `runMessageToEvents` émet plusieurs events/message vs un dans le ledger → changement de rendu live console qui exige une vérif end-to-end avec un vrai run (documenté).

**Phase 4 — boucle orchestrateur : tranche FAITE** (`4db5083`) : `OrchestratorTurnInput.projectId` ajouté ; un tour scopé projet crée une **task liée + run rattaché** via le domaine projects (plus de run orphelin — critère de sortie du §6). *(Reste : câbler les callers telegram/web pour passer projectId, piloter le workspace côté engine, émettre les events contrat manquants.)*

**Tests Playwright : ✅** (`955f7fb`) — `@playwright/test` contre le stack live (dev-login storageState) : nav Projects-first, page Runtimes, /chat → 404. `bun run test:e2e:pw`. 5/5.

**Retest final (tout vert) :** web `tsc` ✅ · engine `tsc` + `bun test` ✅ **211/0** · daemon `go build`+`vet`+`test` ✅ · Playwright ✅ **5/5**.

**Reste (suivi, non bloquant)** : ledger step (b) (bascule SSE, vérif live run) · câblage callers orchestrateur + workspace + events contrat · relocalisation `publishAgent` → domaine agents · Policy d'approbation déclarative · ADR Multica. Décision #3 (hermes défaut) débloquée côté gate (RBAC + Pause forte livrés ; reste la Policy en suivi).

---

## 1. Verdict en une page

Le moteur d'exécution est la bonne nouvelle : le daemon Go est solide, les 5 runtimes du North Star sont réels et câblés (`claude, codex, hermes, openai, anthropic` + `custom`, plus de `echo`), le protocole 18 endpoints est cohérent Go↔TS, le clone de workspace et la propagation du cancel (SIGTERM) fonctionnent. Le modèle de données Projects est lui aussi réel et complet (Project/Task/Resource/Workspace/Comment avec machine d'état). Le produit n'est donc PAS un château de cartes — la fondation tient.

L'embourbement est ailleurs : **le produit n'a jamais tranché ses surfaces**. Il existe en double partout — une page `/chat` isolée qui viole frontalement l'interdit explicite du North Star, un `workflow-builder` complet mais inerte (code tracké, routes neutralisées par redirect), une demi-douzaine de routes hors-scope (evals stub, runtimes, skills, memory, observability), et une migration `run_messages`→`run_events` laissée à mi-chemin en dual-write. Trois symptômes d'une même cause : **on a ajouté sans jamais supprimer ni câbler jusqu'au bout.**

Deuxième cause racine : **l'orchestrateur n'est pas la boucle promise.** Il route de l'intention textuelle par regex (`"puis"`, `"then"`) mais ne résout ni projet ni tâche, ne prépare aucun workspace côté engine, et crée des runs orphelins. Le North Star "Intent → Project → Task → Workspace → Run" n'est câblé qu'en surface DB, pas en flux.

Troisième cause — et c'est elle qui monte d'un cran depuis la première passe : **un trou de gouvernance/sécurité béant sur le canal de contrôle.** Le North Star vend "approbations sur actions risquées" ; or les boutons approve/pause/resume/cancel de l'UI passent par WebSocket (`realtime.send`), et `infra/control.ts:23-37` exécute ces actions **sans aucune permission** — seul `teamId` transite par l'upgrade `/realtime` (le code l'admet en commentaire : *"this WS channel is only team-scoped (no user/role)… deferred"*). N'importe quel membre d'équipe approuve une action risquée en contournant `run:approve`. Combiné à hermes en `--yolo` (`hermes.go:165`, auto-approve de toute action dangereuse, pas de TTY serveur) et à une **pause faible** qui n'interrompt pas un CLI en vol, ça forme un bloc de risque P0 unique : un opérateur qui croit pouvoir gater/arrêter un agent destructif ne le peut pas réellement.

Quatrième point : **dérive d'identité non documentée** (Multica vs Agentik), mais le diagnostic initial était faux. Multica n'est pas cantonnée à la landing : 18 fichiers source y font référence — `apps/daemon/internal/runtime/hermes.go` (skills "multica-style"), `apps/engine/src/infra/hub.ts`, `infra/db/schema/_shared.ts`, toute la chaîne d'onboarding web (`components/onboarding/steps/step-*`, `multica-features.tsx`, `nav.ts`). La marque est **tissée dans le daemon, l'engine et l'onboarding**. L'ADR de clarification reste nécessaire, mais son périmètre est bien plus large que "landing publique".

Le redressement reste moins une réécriture qu'un **élagage discipliné + branchement de la boucle orchestrateur + colmatage du trou RBAC.** Faisable en 4 phases sans casser le moteur, à condition de traiter le bloc sécurité avant tout défaut hermes.

## 2. Carte de l'écart (intention ↔ réalité)

| Règle produit (North Star) | Statut | Preuve |
|---|---|---|
| Projects sont le centre (pas le chat) | 🟡 partielle | `session-guard.tsx:26` redirige post-login vers `/projects` ✅, mais `config/nav.ts:47` met `command-center` **avant** `projects` (l.57) |
| Tasks = unité de travail de 1er ordre | ✅ respectée | `infra/db/schema/projects.ts:45-75` (statuts, priorité, agent, lastRunId) ; `projects/service.ts:94-124` |
| Runs = exécutions observables | ✅ respectée | console SSE live `features/run-view/run-view.tsx:48` ; `runs-board` kanban multi-status |
| Agents = profils (runtime+tools+model+perms) | ✅ respectée | 4 surfaces distinctes : registry / builder / fleet / (chat) |
| Runtimes interchangeables (Codex\|Claude\|BYOK\|hermes) | ✅ respectée | `apps/daemon/main.go:35` 6 kinds réels, `echo` supprimé ; `packages/workflow-schema/src/runtime.ts:10-17` |
| Console web Hermes-like (stream/tools/approve/pause/kill/**resume**/diffs) | 🟡 partielle | stream/approve/pause/cancel câblés ✅ ; **Resume absent de l'UI** alors que l'engine le supporte (WS `control.ts:30` + `POST /runs/:id/resume` `routes.ts:58`) ; **aucun composant diff** ni vue subagents |
| **Approbations = vrai gate de gouvernance** | ❌ **violée (sécurité P0)** | actions approve/pause/resume/cancel dispatchées par WS `realtime.send` → `control.ts:23-37` **sans permission** ; `run:approve`/`run:control` contournés ; seul `teamId` porté par l'upgrade |
| Telegram = canal de contrôle (statuts/approbations) | ✅ respectée | `runs/service.ts:508-521` notif Telegram inline actions |
| **INTERDIT : pas de page chat lite isolée** | ❌ **violée** | `app/[team]/(app)/chat/page.tsx` + `chat/c/[threadId]` + `chat/settings` + 2 bridges API (`/api/agent-chat`, `/api/chat`) hors nav |
| Orchestrator = boucle Intent→Project→Task→Workspace→Run | ❌ violée | `chat/orchestrator.ts:19-27` : `OrchestratorTurnInput` n'a ni `projectId` ni `taskId` ; routage par regex ; aucun clone workspace initié par l'engine |
| Workspace préparé par l'engine (clone/branche) | 🟡 partielle | clone réel **côté daemon** (`daemon/internal/runtime/workspace.go:56-123`) ✅ mais l'engine ne pilote pas la boucle ; pas de sérialisation → risque double-clone (`repo.ts:299`) |
| Pause/kill/resume effectifs | 🟡 partielle | cancel→SIGTERM ✅ ; **pause faible** : n'envoie aucun signal daemon, n'interrompt pas un CLI en vol (`controls.ts:90-116`) — critique sous hermes `--yolo` |
| Routes cibles (`/keys`, `/channels/telegram`) | 🟡 partielle | `/keys` absente (tokens enfouis dans `settings/tabs/tokens-tab.tsx`) ; pas de sous-route `channels/telegram` |
| `run_events` = source de vérité du ledger | ❌ violée | dual-write `daemon/repo.ts:683-725` mais SSE lit **uniquement** `run_messages` (`live-stream.ts:96`) ; runs antérieurs au dual-write n'ont **pas** de `run_events` |
| `repo.ts` seule couche DB d'un domaine (invariant #2) | ❌ violée (systémique) | `runs/service.ts` écrit `agents` (l.170/222), `runs` (l.276/321), `projectTasks` (l.358/398) — cross-domaine + intra-domaine |
| Multica = périmètre documenté | ❌ non documenté | 18 fichiers source (`hermes.go`, `hub.ts`, `_shared.ts`, onboarding, `nav.ts`) — pas une simple landing |

## 3. À SUPPRIMER (remove)

| P | Quoi | Pourquoi | Preuve d'inutilité | Risque |
|---|---|---|---|---|
| **P0** | `components/runtime/demo-runtime-provider.tsx` | Code mort, branche `/api/chat` générique au lieu de la vraie runtime | grep → seul self-import | Aucun (zéro importeur) |
| **P0** | `components/runtime/tools-registrar.tsx` | Orphelin, importé uniquement par le provider mort ci-dessus | `tools-registrar.tsx:51` + import dans demo-runtime-provider seul | Aucun |
| **P0** | `app/api/chat/route.ts` | Vecteur LLM direct front→providers sans Run/observation, hors-scope archi | Seul appelant = demo-runtime-provider (mort) + 2 commentaires (`tools-registrar.tsx:88`, `lib/llm/registry.ts:16`) | **Aucune dépendance smoke-test** (`grep "api/chat" apps/web/scripts/` → 0 hit). Suppression sûre et directe |
| **P0** | Route `/chat` (`page.tsx` + `c/[threadId]` + `settings`) | **Viole l'INTERDIT explicite** du North Star ; bridge `/api/agent-chat` crée des runs non observables (pas de run_id, pas de timeline) | Hors nav (`grep chat config/nav.ts` → 0) | Met à jour `memory/MEMORY.md` (`prefer-thechat-ui-for-chat.md`) ; migrer/jeter les `LocalThreadHistory` client |
| **P1** | `features/runs-list/runs-table.tsx` | Doublon latent du `runs-board` (surface canonique) | Jamais importé hors self | Aucun |
| **P1** | `features/settings/tabs/runtimes-tab.tsx` (+ test) | Inaccessible : absent de `team-settings-page.tsx` (4 onglets) | Référencé seulement par son test | Aucun |
| **P1** | `components/landing/multica-onboarding.tsx` | Shim `@deprecated` sans consommateur | grep → self only | Aucun. **Mais** ne pas généraliser : le reste de la chaîne Multica (onboarding, hermes, hub) est vivant — voir §7 #4 |
| **P1/P2** | Bloc workflow-builder inerte : `features/workflow-builder/`, `packages/workflow-engine/`, `execution/worker/worker.ts` (BullMQ), `credentials/*-picker.tsx` | Code tracké mort : `executor='workflow'` jamais traité par le daemon ; BullMQ tire `OPENAI_API_KEY` hardcodé (`worker.ts:13`) | Les 3 routes sont **proprement neutralisées** (toutes `redirect(/${team}/command-center)`) — ce n'est PAS une "route vivante" | **Décision fondateur requise** (§7 #2). Drainer la queue Redis avant de retirer le package |
| **P2** | `mocks/` (6 fichiers) + `public/mockServiceWorker.js` | MSW opt-in jamais activé par défaut, bruit en prod | `NEXT_PUBLIC_USE_MOCK=true` requis | Garde si utilisé en tests ; aligner d'abord les handlers sur les 5 runtimes |

## 4. À MODIFIER (modify)

| P | Quoi | Pourquoi | Effort |
|---|---|---|---|
| **P0 (sécurité)** | **Plomber l'identité (user/role) dans `WsData` et gater `control.ts:23-37`** sur `run:approve`/`run:control` ; faire échouer l'action si la permission manque | Le canal WS contourne tout le RBAC HTTP (`control.ts:23-37`, aveu en commentaire) → tout membre approuve une action risquée. Détruit la promesse "approbations" | **M** |
| **P0 (sécurité)** | **Pause forte côté daemon** : sur `/tasks/:id/messages`, renvoyer un signal `cancel`-like quand `status='paused'` pour suspendre le CLI en vol | `pauseRun` (`controls.ts:90-116`) n'envoie aucun signal ; sous hermes `--yolo` un run continue d'exécuter des actions auto-approuvées malgré le Pause | **M** |
| **P0** | Ajouter le bouton **Resume** dans `features/run-view/run-controls.tsx` (conditionnel `status==='paused'`) | Câblé end-to-end et vérifié (WS `control.ts:30` → `resumeRun` **et** `POST /runs/:id/resume` `routes.ts:58`). Console Hermes-like incomplète sans lui. NB : passe par le même canal WS → bénéficie du fix RBAC ci-dessus | **S** |
| **P0/P1** | Sortir de `runs/service.ts` **toutes** les écritures cross-domaine : `projectTasks` (l.358/398) → barrel `projects/index.ts` (`markTaskReview`/`markTaskBlocked`) ; `agents` (l.170/222) → barrel `agents/index.ts` | Viole l'invariant #2 (`service.ts` touche la DB) de façon **systémique**, pas ponctuelle. Le danger réel est le cross-domaine (`projectTasks`+`agents`) : casse silencieuse si la table migre | **M** (le cross-domaine seul = S ; conformité complète, intra-`runs` inclus = L) |
| **P1** | Corriger l'import deep `projects/repo.ts:4` (`../learning/memory/repo` → barrel `../learning/index`) | Viole invariant #3 (cross-domain via barrel) | **S** |
| **P1** | Hisser **Projects en 1er item de nav** (avant command-center) ou faire de command-center la vue projects | `nav.ts:47/57` contredit le North Star "Projects au centre" et la redirect post-login | **S** |
| **P1** | Câbler l'orchestrateur à la boucle (voir §6 Phase 3) : `projectId`+`taskId` dans `OrchestratorTurnInput`, créer/lier la task avant le run, piloter le workspace | `orchestrator.ts:19-27` route par regex sans résoudre projet → runs orphelins (Telegram/signals) | **L** |
| **P2** | Sérialiser `ensureProjectWorkspace` (`repo.ts:299`) par (team,project,resource) | Deux daemons concurrents → double clone | **M** |

## 5. À AJOUTER (add)

| P | Quoi | Critère North Star débloqué | Effort |
|---|---|---|---|
| **P0** | **Backfill `run_events` depuis `run_messages`** (migration dédiée) avant toute bascule SSE | Sans lui, basculer le SSE sur `run_events` fait **disparaître le transcript de tous les runs antérieurs au dual-write** (qui n'ont pas de `run_events`). À séquencer en 2 migrations : backfill → bascule → retrait `run_messages` | **M** |
| **P1** | Policy d'approbation déclarative en DB (table) au lieu du keyword-scan regex `projects/service.ts:60-90` | Approbations auditables/configurables ; une tâche destructive en FR non standard bypasse aujourd'hui le gate. Brique du même bloc sécurité que le RBAC WS + pre-flight hermes | **M** |
| **P1** | Émettre les événements contrat manquants (`subagent.started/finished`, `file.changed`, `memory.proposed`) — `runs/events.ts` n'en couvre que 5/18 | Vues diff + subagents + memory de la console Hermes-like (impossibles sans) | **L** |
| **P1** | Composant **diff viewer** dans `features/run-view/` pour les runs `code` | "diffs" cité explicitement comme surface Hermes-like ; aucun composant n'existe | **M** |
| **P1** | Route `/:team/keys` dédiée | Route cible du North Star ; tokens aujourd'hui enfouis dans `settings/tabs/tokens-tab.tsx` | **S** |
| **P1** | ADR documentant le split **Multica ↔ Agentik** — périmètre **réel** : landing **+** onboarding web **+** skills "multica-style" du daemon (`hermes.go`) **+** `engine/infra` (`hub.ts`, `_shared.ts`) | Lève la contradiction lue par chaque dev/agent ; la marque est tissée dans 3 couches, pas isolable d'un trait | **S** |
| **P2** | Entrée `signals` + le split Multica dans `docs/ARCHITECTURE.md` | Domaine réel (`domains/signals/*`) absent de la doc de référence → refacto aveugle | **S** |
| **P2** | Sous-route `/:team/channels/telegram` (deep-link depuis notifications) | Route cible ; point d'entrée stable du binding Telegram | **S** |

## 6. Plan de redressement en phases

**Phase 0 — Élagage (1-2 j, zéro risque produit).**
Supprimer tout le code mort P0/P1 sans dépendance (demo-runtime-provider, tools-registrar, `/api/chat`, runs-table, runtimes-tab, multica-onboarding). `/api/chat` se retire **directement** (aucune dépendance smoke-test). Mettre à jour `MEMORY.md`.
*Sortie vérifiable :* `bunx tsc --noEmit` (web) + `bun test` verts ; `grep` des symboles supprimés = 0 hit.

**Phase 1 — Bloc sécurité du canal de contrôle (3-5 j, PRIORITAIRE).**
Plomber user/role dans `WsData`, gater `control.ts` sur `run:approve`/`run:control`, implémenter la pause forte côté daemon, ajouter le bouton Resume. Garantir le pre-flight approval toujours actif. **Ce bloc précède tout passage de hermes en défaut** (§7 #3).
*Sortie :* un membre sans `run:approve` voit l'action WS **refusée** (ack `accepted:false`) ; un Pause interrompt réellement un CLI hermes/codex en vol ; Resume fonctionnel sur un run en pause (test manuel + browser).

**Phase 2 — Trancher /chat et workflows + recentrer la nav (2-3 j).**
Décision fondateur appliquée (§7) : supprimer la route `/chat` isolée (l'UX chat passe par ProjectConsole/AgentDetail) et trancher workflow-builder (le code inerte, pas une route vivante : enterrer = retirer `features/workflow-builder/` + `packages/workflow-engine/` + worker BullMQ après drain Redis). Hisser Projects en 1er.
*Sortie :* aucune route hors routes cibles accessible depuis la nav ; plus de package workflow-engine tracké si enterré.

**Phase 3 — Conformité architecture + ledger unique avec backfill (4-5 j).**
Corriger les violations invariant #2 (écritures `projectTasks`+`agents` cross-domaine → barrels) et #3 (import deep learning). **Ledger en 2 migrations : (a) backfill `run_events` depuis `run_messages`, (b) bascule SSE sur `run_events`, puis retrait du path live `run_messages`** — jamais en une étape. Documenter signals + split Multica dans ARCHITECTURE.md.
*Sortie :* invariants #2/#3 respectés (revue grep) ; SSE web et Telegram alimentés par la même table ; transcript des runs historiques **toujours visible** après bascule ; `bunx drizzle-kit check` sans drift.

**Phase 4 — Brancher la vraie boucle orchestrateur (5-8 j, le cœur).**
`projectId`/`taskId` dans l'orchestrateur, création/liaison de task avant run, pilotage du workspace, émission des événements contrat manquants, diff viewer, Policy d'approbation déclarative, route `/keys`, sous-route `channels/telegram`.
*Sortie :* un message Telegram "fais X sur le projet Y" crée une task liée + un run rattaché visible dans la vue projet ; un run `code` affiche ses diffs ; une action risquée déclenche un gate **configurable** (pas regex) ; les events subagent/file.changed apparaissent dans la console.

## 7. Décisions à trancher par le fondateur

1. **`/chat` : on tue ou on intègre ?** L'analyse converge (alignment + deadcode P0) : c'est l'objet explicitement interdit. Ma reco = **supprimer la route isolée** et ne garder le "quick chat" qu'en dialog dans `ProjectConsole`/`AgentDetail`. *Mais* tu dois confirmer car la mémoire projet dit "reuse immersive assistant-ui Base" — il faut migrer les `LocalThreadHistory` ou accepter la perte.

2. **`workflow-builder` : restaurer ou enterrer ?** Cadrage corrigé : ce n'est **pas** "route live + nav désactivée". Les 3 routes redirigent toutes vers command-center (`(app)/workflows`, `(canvas)/workflows/new`, `(canvas)/workflows/[workflowId]`) — le builder est proprement parqué. La vraie dette est le **code tracké inerte** (14 fichiers `features/workflow-builder/` + `packages/workflow-engine/` + worker BullMQ avec `OPENAI_API_KEY` hardcodé), pas une surface trompeuse. Si aucun plan daté ne le ramène → **enterrer** (le North Star ne parle jamais de canvas). Décision binaire.

3. **hermes runtime par défaut ?** Hermes est le plus riche mais tourne en `--yolo` (auto-approve de toute action dangereuse, `hermes.go:165`, faute de TTY serveur). **Pré-requis bloquant : le bloc sécurité Phase 1 (RBAC WS + pause forte + pre-flight toujours actif) doit être livré AVANT tout défaut hermes.** Tant que le Pause n'interrompt pas un run en vol et que le WS bypasse `run:approve`, hermes par défaut = un agent destructif auto-approuvé qu'un opérateur ne peut ni gater ni arrêter. À trancher avec la Policy (Phase 4).

4. **Rôle de Multica ?** **Correction de la passe précédente** : Multica n'est PAS introuvable dans le code (45 occurrences, 18 fichiers source). Elle est tissée dans le daemon (skills "multica-style", `hermes.go`), l'engine (`infra/hub.ts`, `db/schema/_shared.ts`) et toute la chaîne d'onboarding web (`step-*`, `multica-features.tsx`, `nav.ts`). Ce n'est donc pas un branding de landing isolable : soit Multica est la face publique/le code-name d'Agentik (alors un ADR le formalise et la cohérence de nommage suit), soit c'est un produit tiers (alors il faut le désentrelacer du daemon et de l'engine, pas juste de `app/page.tsx`). Aucune décision produit ne peut s'appuyer dessus tant que ce n'est pas écrit — et le chantier de clarification est plus large qu'estimé.

5. **Routes hors-scope (evals stub, runtimes, skills, memory, observability, reviews).** Au moins 6 surfaces sans backend confirmé ou absorbables dans Projects/Runs. Veux-tu un MVP strictement aligné sur les routes cibles (donc supprimer/parquer le reste), ou assumer un périmètre élargi ? Mon biais : **MVP strict** — chaque route morte est un coût de cohérence qui entretient le sentiment d'embourbement.