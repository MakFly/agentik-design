# Subagents

Subagents are specialist workers coordinated by the orchestrator. They do not own product state directly; they return structured findings, patches, or verification reports to the parent run.

## Standard Roles

```txt
Product Architect
  clarifies product intent, scope, user workflows, and IA.

Repo Cartographer
  maps code paths, routes, schemas, tests, and existing conventions.

UI/TUI Architect
  designs the web cockpit and Hermes-like live console.

Engine/API Architect
  designs Hono routes, Drizzle schema, RBAC, SSE/WS, and persistence.

Runtime Adapter Engineer
  integrates Codex, Claude Code, shell, git, workspace, and provider adapters.

Telegram Channel Engineer
  implements pairing, commands, summaries, approvals, and run controls.

QA/Verifier
  defines and executes checks, regression tests, and acceptance evidence.
```

## Handoff Rules

- Each subagent receives the project, task, current files, constraints, and expected output.
- Each subagent returns a short report with evidence and concrete recommendations.
- Implementation subagents must declare changed files, commands run, and residual risks.
- Verification subagents must report exact checks and whether they passed.
- The orchestrator is responsible for deciding which subagent output becomes project memory.

## Output Formats

```txt
finding:
  severity: blocker | high | medium | low
  area: product | ui | engine | runtime | channel | tests
  evidence: file path, command output, or observed behavior
  recommendation: concrete next action

patch_result:
  files_changed: list
  behavior_changed: summary
  checks_run: list
  risks: list

memory_candidate:
  scope: repo-routing | tooling | product | runtime | user-preference
  content: confirmed instruction
  source: run | telegram | web
  confidence: proposed | confirmed
```

## Non-Goals

- Do not spawn subagents for trivial edits.
- Do not let subagents mutate shared memory without orchestrator approval.
- Do not create one-off role names when a standard role fits.
- Do not stream all subagent chatter to Telegram; summarize milestones only.
