# Acceptance Matrix

This file tracks the current rebuild evidence against `BUILD_GUIDELINE.md`.
It is not a replacement for tests; it points to the code paths and checks that
prove each requirement.

## Current Evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Project-centric first screen | `apps/web/app/[team]/(app)/command-center/page.tsx`, `apps/web/features/command-center/command-center-screen.tsx` | Implemented |
| Project page shows context, resources, tasks, active runs, memories, workspaces, channels | `apps/web/features/projects/project-detail-screen.tsx` | Implemented |
| Run page shows timeline, selected step, controls, costs, artifacts, failures | `apps/web/features/run-view/run-view.tsx`, `apps/web/features/run-view/run-summary.tsx` | Implemented |
| Project task creates observable run | `apps/engine/src/projects-repo.test.ts` | Tested |
| Confirmed project memory is injected into future runs | `apps/engine/src/projects-repo.test.ts`, `apps/engine/src/learning-repo.test.ts` | Tested |
| Workspace is prepared and bound to project task runs | `apps/engine/src/projects-repo.test.ts`, `apps/daemon/internal/runtime/workspace_test.go` | Tested |
| Workspace `AGENTS.md` reaches runtime context | `apps/daemon/internal/loop/preflight_test.go` | Tested |
| Preflight approval blocks risky runs until approved | `apps/engine/src/run-controls.test.ts`, `apps/daemon/internal/loop/preflight_test.go` | Tested |
| Run artifacts include summary, changed files, diff stats, checks | `apps/engine/src/run-controls.test.ts`, `apps/daemon/internal/loop/artifacts_test.go`, `apps/daemon/internal/runtime/workspace_test.go` | Tested |
| Runner adapters: Claude Code, Hermes, Codex, BYOK providers | `apps/daemon/internal/runtime/*.go`, `apps/daemon/internal/runtime/provider_test.go` | Implemented and partially tested |
| Orchestrator event names are carried on the live SSE envelope | `apps/engine/src/agents-repo.ts`, `apps/engine/src/server.ts`, `apps/engine/src/live-stream.test.ts`, `apps/web/types/events.ts` | Tested |
| Telegram pairing, list, start, status, approve/reject, pause/resume/kill, learn | `apps/engine/src/channels-repo.test.ts` | Tested |
| Telegram run messages link to canonical web run page | `apps/engine/src/channels-repo.test.ts` | Tested |
| Learning loop proposes reviews and applies approved memory/skills | `apps/engine/src/moat-integration.test.ts`, `apps/engine/src/review-agent.test.ts` | Tested |

## Latest Checks

```txt
apps/daemon: go test ./...
apps/engine: bun test
apps/web: bun run typecheck
```

## Remaining Audit Before Completion

- Browser-level smoke proof for the project cockpit and run console is still missing.
- Real CLI execution for Claude/Codex/Hermes is adapter-level and environment-dependent; tests cover contracts and provider HTTP adapters, not live external accounts.
