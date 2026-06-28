# Dead Code Audit

Status: initial audit for the Hermes/OpenClaw parity refactor.

## Rules

- Do not delete a surface until it has no active route, import, script, or test.
- Prefer removing entire parked features over leaving disabled navigation and redirect-only pages.
- Keep compatibility code only with a named migration exit.
- Run `bun run audit:dead-code` before each cleanup batch and record the result in the PR.

## Initial Findings

### Mock Layer

Decision: quarantine, then remove after tests no longer import MSW.

Evidence:
- `apps/web/app/providers.tsx` imports `MswReady`.
- MSW is opt-in through `NEXT_PUBLIC_USE_MOCK=true`.
- Real E2E already asserts that the mock service worker is not active.

Cleanup path:
- Replace MSW-backed tests with unit fixtures or live engine paths.
- Remove `apps/web/mocks/*`, `apps/web/public/mockServiceWorker.js`, MSW package metadata, and the provider wrapper.

### Parked Workflow Builder

Decision: either restore as a real product surface or delete from the Hermes/OpenClaw cockpit path.

Evidence:
- Workflow routes redirect to command center.
- Navigation marks workflows as `comingSoon`.
- `packages/workflow-engine` remains wired into engine dependencies.

Cleanup path:
- If not restored in this refactor, remove workflow route entries, workflow-builder UI, workflow engine package dependency, and related docs.
- If restored, it must emit the same run event ledger as agent runs.

### Demo UI

Decision: remove from cockpit runtime path after confirming assistant chat still compiles.

Evidence:
- `components/examples` and `components/runtime/demo-runtime-provider.tsx` are demo-oriented.
- The target product should not carry a separate lite/demo chat path.

Cleanup path:
- Keep only reusable assistant components used by real chat or run console.
- Delete demo provider and example wrappers.

### Legacy Run Messages

Decision: keep as a read-compat layer until `run_events` exists, then migrate and remove from render paths.

Evidence:
- `run_messages` still drives run detail, live stream, Telegram progress, reviews, and chat persistence.
- The previous UI bug comes from rendering raw `tool_use` and `tool_result` as independent steps.

Cleanup path:
- Use grouped mapper immediately.
- Add `run_events` as source of truth.
- Backfill from `run_messages`.
- Remove `runMessageToStep` direct usage from web-facing paths.

### Marketing Surface

Decision: verify separately, not part of runtime refactor.

Evidence:
- Landing components and assets do not affect the authenticated cockpit.

Cleanup path:
- Leave untouched in this refactor unless package audit proves unused dependencies or route conflicts.
