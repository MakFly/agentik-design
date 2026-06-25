# Build Guideline

This guideline is the rebuild contract for Agentik. The goal is a clean agentic system for TPE/PME operations and coding work: project-centric orchestration, Hermes-like execution visibility, OpenClaw-like channels, and runner adapters for Codex, Claude Code, and BYOK providers.

## Architecture

```txt
Channels
  Web | Telegram
    |
    v
Gateway
  auth | pairing | commands | rate limit | normalization
    |
    v
Orchestrator
  projects | tasks | agents | runs | policies | memory
    |
    v
Execution
  workspaces | Codex | Claude Code | BYOK providers | tools
    |
    v
Observation
  Hermes-like console | timeline | approvals | diffs | summaries
```

## Phase Order

1. Stabilize the project model: projects, tasks, workspaces, runs, agents, memories, policies.
2. Build the web cockpit around Projects first, then Tasks, Runs, Agents, Channels, and Keys.
3. Build the Hermes-like run console with event timeline, live stream, approvals, diffs, and run controls.
4. Add runner adapters behind one normalized execution contract.
5. Add Telegram as a channel adapter for commands, approvals, and summaries.
6. Add the learning loop: confirmed project memory, review proposals, and context injection.

## Required UX

- First screen after navigation should expose actual work, not a marketing page.
- A project page must show context, repo/workspace, tasks, active runs, memories, and linked channels.
- A run page must answer: what is happening, why, which tools ran, what changed, what failed, and what it costs.
- Telegram responses must be short and actionable, with links to the full web run.
- Approval requests must be explicit and reversible when possible.

## Implementation Rules

- Prefer existing repo patterns, schemas, API helpers, and UI primitives.
- Use `bun` for every package command.
- Read local Next.js docs before changing Next.js route behavior.
- Do not add another isolated chat clone or "lite" console.
- Keep workflow-canvas ideas parked unless a future plan explicitly brings them back.
- Every new public API needs a typed client or shared contract and at least one targeted test.
- Every destructive or external action by an agent needs policy and approval semantics.

## Acceptance

- A user can create or open a project, define a task, assign an agent, start a run, watch it live, approve/deny risky actions, and receive a final result.
- A coding task can prepare a workspace, edit files through a runner, run tests, and report changed files.
- A Telegram user can list projects/tasks, start a task, check status, approve/reject, pause/resume/kill, and add confirmed project memory.
- The same run is observable from web and controllable from approved channels.
