# Acceptance Matrix

This file tracks the current rebuild evidence against `BUILD_GUIDELINE.md`.
It is not a replacement for tests; it points to the code paths and checks that
prove each requirement.

## Current Evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Project-centric first screen | `apps/web/app/[team]/(app)/command-center/page.tsx`, `apps/web/features/command-center/command-center-screen.tsx`, `scripts/ui-structure-audit.ts` | Tested |
| Project page shows context, resources, tasks, active runs, memories, workspaces, channels | `apps/web/features/projects/project-detail-screen.tsx`, `scripts/ui-structure-audit.ts` | Tested |
| Browser smoke harness checks project cockpit task board, agent console, context rail, resources, channels, approvals, email delivery evidence, and run console transcript, then writes a JSON proof artifact | `apps/web/scripts/e2e-seeded-loop.ts`, `scripts/acceptance-proof-audit.ts`, `artifacts/acceptance/agentik-loop-1782738923976.json` | Tested |
| Run page shows timeline, selected step, controls, costs, artifacts, failures | `apps/web/features/run-view/run-view.tsx`, `apps/web/features/run-view/run-summary.tsx`, `apps/web/features/run-view/run-transcript.tsx`, `scripts/ui-structure-audit.ts` | Tested |
| Run page shows operator input context, including Telegram attachment markers and document previews | `apps/web/features/run-view/run-summary.tsx`, `apps/web/features/run-view/run-summary.test.ts`, `apps/engine/tests/domains/runs/run-cost-mapper.test.ts` | Tested |
| Run page shows orchestration subagent plan, step status, and child run links | `apps/web/features/run-view/run-summary.tsx`, `apps/web/features/run-view/run-summary.test.ts`, `apps/engine/tests/domains/runs/run-cost-mapper.test.ts` | Tested |
| Project task creates observable run | `apps/engine/tests/domains/projects/projects-repo.test.ts` | Tested |
| Confirmed project memory is injected into future runs | `apps/engine/tests/domains/projects/projects-repo.test.ts`, `apps/engine/tests/domains/learning/learning-repo.test.ts` | Tested |
| Workspace is prepared and bound to project task runs | `apps/engine/tests/domains/projects/projects-repo.test.ts`, `apps/daemon/internal/runtime/workspace_test.go` | Tested |
| Workspace `AGENTS.md` reaches runtime context | `apps/daemon/internal/loop/preflight_test.go` | Tested |
| Preflight approval blocks risky runs until approved | `apps/engine/tests/domains/runs/run-controls.test.ts`, `apps/daemon/internal/loop/preflight_test.go` | Tested |
| Run artifacts include summary, changed files, diff stats, checks | `apps/engine/tests/domains/runs/run-controls.test.ts`, `apps/daemon/internal/loop/artifacts_test.go`, `apps/daemon/internal/runtime/workspace_test.go` | Tested |
| Runner adapters: Claude Code, Hermes, Codex, BYOK providers | `apps/daemon/internal/runtime/*.go`, `apps/daemon/internal/runtime/claude_test.go`, `apps/daemon/internal/runtime/hermes_test.go`, `apps/daemon/internal/runtime/codex_oauth_test.go`, `apps/daemon/internal/runtime/provider_test.go`, `scripts/runner-proof-audit.ts`, `artifacts/acceptance/agentik-runner-smoke-1782738094175.json`, `artifacts/acceptance/agentik-runner-smoke-1782738094202.json`, `artifacts/acceptance/agentik-runner-smoke-1782739020468.json` | Tested |
| Runner smoke harness can execute selected daemon runtimes locally and write JSON proof artifacts per runtime | `apps/daemon/runtime_smoke.go`, `scripts/runner-proof-audit.ts`, `artifacts/acceptance/agentik-runner-smoke-*.json` | Tested |
| Orchestrator event names are carried on the live SSE envelope | `apps/engine/tests/domains/runs/live-stream.test.ts`, `apps/web/types/events.ts` | Tested |
| Telegram pairing, list, start, status, approve/reject, pause/resume/kill, learn | `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram syncs a native Bot API command menu for the operator control surface | `apps/engine/src/domains/channels/telegram/client.ts`, `apps/engine/src/domains/channels/repo.ts`, `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram run messages link to canonical web run page | `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram approval notifications include typed inline approve/reject actions and callback handling | `apps/engine/tests/domains/channels/channels-repo.test.ts`, `apps/engine/tests/domains/runs/telegram-presenter.test.ts` | Tested |
| Telegram chat sessions keep an active run so short controls work without repeating the run id | `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram chat sessions keep an active project so `/tasks` and `/learn` work without repeating the project id | `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram can show active project context before launching work with `/context` | `apps/engine/src/domains/channels/telegram/commands.ts`, `apps/engine/src/domains/channels/telegram/execute-command.ts`, `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram can show active or selected agent capabilities before launching work with `/skills` | `apps/engine/src/domains/channels/telegram/commands.ts`, `apps/engine/src/domains/channels/telegram/execute-command.ts`, `apps/engine/src/domains/agents/repo.ts`, `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram can create and launch a task from the active project with `/run "title"` | `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram group bindings only route real bot mentions, `/command@bot`, or replies to the bot | `apps/engine/src/domains/channels/telegram/dispatch.ts`, `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram forum topics keep isolated active project/run sessions inside the same group | `apps/engine/src/domains/channels/telegram/dispatch.ts`, `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram free-form replies include the replied message as run input context | `apps/engine/src/domains/channels/telegram/dispatch.ts`, `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Telegram captions and common attachment metadata route into runs instead of being ignored | `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Small text-like Telegram documents can add downloaded preview context to the run input | `apps/engine/tests/domains/channels/channels-repo.test.ts` | Tested |
| Learning loop proposes reviews and applies approved memory/skills | `apps/engine/tests/domains/learning/moat-integration.test.ts`, `apps/engine/tests/domains/learning/review-agent.test.ts` | Tested |

## Latest Checks

```txt
apps/daemon: go test ./...
apps/engine: bun test
apps/web: bun run typecheck
root: bun run audit:acceptance
root: bun run audit:ui
after live smoke: bun run audit:acceptance:proof artifacts/acceptance/<session>.json
runner smoke: bun run smoke:runner:echo && bun run audit:runner:proof
live runner proof: bun run smoke:runner:claude && bun run smoke:runner:codex && bun run smoke:runner:hermes && bun run audit:runner:proof:live
final gate: bun run audit:completion
```

## Remaining Audit Before Completion
