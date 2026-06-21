# Phase 3 — Conditional branching · Review & browser test

_Date : 2026-06-21 · Scope : node `decision` (branching) + executor v2._

## 1. Ce qui a été construit

- **Moteur — executor v2** (`packages/workflow-engine/src/executor.ts`) : activation
  conditionnelle des edges. Un nœud s'exécute s'il est *atteint* (trigger ou ≥1 edge
  entrant actif). Les nœuds normaux activent tous leurs edges sortants ; les nœuds de
  branchement (méthode `route()`) n'activent que le handle choisi → les branches non
  prises sont ignorées.
- **Node `decision`** (`nodes/decision.ts`) : passthrough des données + `route()` qui
  évalue chaque branche (`expression`) et renvoie le label du premier match, sinon le
  `default`.
- **Front** : handles multiples sur le nœud decision (un par branche, `id = label`),
  éditeur de branches dans le node-panel (label + expression + default).
- **Différé** : `Loop` (cyclique / sous-graphe) et `Merge` (nouveau type) — plus lourds,
  hors de cette passe.

## 2. Revue `crew-reviewer` — findings & corrections

| Sévérité | Finding | Statut |
|---|---|---|
| **MAJOR** | Rename d'un label de branche ne mettait pas à jour `sourceHandle` des edges existants → branche silencieusement morte | **Corrigé** — actions store `renameDecisionBranch` / `removeDecisionBranch` qui remappent/suppriment les edges de façon atomique (un seul undo) |
| WARN | `route()` voyait son propre output (`outputs[self]`) | **Corrigé** — `route()` appelé avant d'enregistrer l'output |
| WARN | `topoSort.incoming` devenu valeur de retour morte | **Corrigé** — retiré de `TopoResult` |
| WARN | Node agent : signal déjà aborté non vérifié | **Corrigé** — garde en début d'`execute` |
| INFO | `planWorkflowRun` « mort » | Faux positif — exporté & testé, conservé |
| INFO | `key={i}` sur la liste de branches | Cosmétique, laissé |

Verdict reviewer : _« structurally sound, executor skip logic correct, contract coherent,
imports clean, 14 engine tests pass »_ — le seul blocker (rename desync) est corrigé.

## 3. Test navigateur (`ghostchrome`)

App lancée localement (web `:3333`, moteur `:8787`, worker BullMQ).

- **`/acme/workflows`** : la liste affiche les **vrais workflows du moteur** (Agent E2E,
  Proxy E2E, Demo HTTP→Code…) avec version (`v1`/`Draft`) et « Ran X ago ». **0 erreur console.**
- **`/acme/workflows/new`** : le builder se charge proprement — toolbar (Save / Execute /
  Inactive / historique), palette catégorisée (Triggers · Agents · Logic · Actions) avec
  les 10 types dont **Decision**, canvas `Manual trigger → End`, zoom + minimap.
- Capture : **`docs/phase3-review/builder.png`** (1280×800).

## 4. Preuve fonctionnelle du branching (run réel via le moteur)

Workflow `trigger → decision(amount>100 ? big : small) → code`, exécuté par le worker :

```
amount=250  -> succeeded | code exécutés: [big]
amount=50   -> succeeded | code exécutés: [small]
```

→ Seul le nœud de la branche prise s'exécute. L'autre est ignoré. ✅

## 5. Vérifications

| Check | Résultat |
|---|---|
| Tests moteur (`packages/workflow-engine`) | **14 ✓** (dont branching) |
| Tests web (vitest) | **23 ✓** |
| Typecheck (web + engine + packages) | ✓ |
| Lint web | ✓ (0 erreur, 1 warning pré-existant) |
| e2e branching live | ✓ |
| e2e UI navigateur | ✓ (liste + builder, 0 erreur console) |

## 6. Risques résiduels (inchangés)

- Redis infra en `allkeys-lru` (BullMQ préfère `noeviction`).
- Node Code en `node:vm` (pas un sandbox de sécurité — ok mono-tenant local).
- Pas d'auth réelle (header `x-team` seul).

> La capture `builder.png` est volontairement **non commitée** (`*.png` gitignoré, règle projet) ;
> elle reste sur disque dans ce dossier pour consultation.
