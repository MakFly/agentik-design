# Orchestrator

The orchestrator is the single control loop that turns user intent into observable agent work. It owns routing, policy, context assembly, run lifecycle, and handoff between channels, UI, runners, and subagents.

## Control Loop

```txt
Intent
  |
  v
Project resolution
  |
  v
Task creation
  |
  v
Agent/runtime selection
  |
  v
Workspace preparation
  |
  v
Run execution
  |
  v
Live observation + approvals
  |
  v
Result, review, memory update
```

## Responsibilities

- Resolve the team, project, task, agent, runtime, channel, and permissions before execution.
- Build the context pack from project memory, repo facts, task instructions, AGENTS.md, and selected subagent guidance.
- Prepare an isolated workspace when the task requires code work: clone repo, checkout branch, inject context, and track changed files.
- Route execution to the selected runner: Codex, Claude Code, OpenAI BYOK, Anthropic BYOK, or OpenRouter BYOK.
- Stream run events to the web console and compact summaries to Telegram.
- Stop for approval before risky actions: destructive shell commands, external writes, secrets, deploys, PR creation, or paid/provider changes.
- Persist the result as a run artifact: summary, logs, files changed, commands, tests, approvals, and next-step suggestions.
- Convert explicit user feedback into project memory only after confirmation.

## Data Model Names

```txt
Project   = business context + repo + objectives
Task      = concrete work item assigned to an agent
Agent     = role + runtime + tools + model/provider + permissions
Run       = observable execution of a task
Workspace = cloned repo or isolated file sandbox
Channel   = web, Telegram, or future external control surface
Memory    = confirmed project knowledge used in future context packs
Policy    = approval and permission rules for agent actions
```

## Event Contract

Every runner should emit normalized events:

```txt
run.started
workspace.prepared
message.created
tool.started
tool.output
approval.requested
approval.resolved
file.changed
test.started
test.finished
subagent.started
subagent.finished
run.paused
run.resumed
run.cancelled
run.failed
run.completed
memory.proposed
```

## Channel Behavior

- Web receives the full run stream.
- Telegram receives compact milestones, approval requests, failures, and final summaries.
- Both channels must link back to the canonical run page.
- Channel commands create tasks or control runs; they do not bypass orchestrator policy.
