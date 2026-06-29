# Agentik Agentic System

This folder is the rebuild source of truth for the Agentik control plane. It replaces the old MVP snapshots and keeps one clear direction: OpenClaw-style channels and orchestration, Hermes-style live operator console, and interchangeable execution through Codex, Claude Code, or BYOK model providers.

## Target Shape

```txt
Web App + Telegram
        |
        v
Channel Gateway
        |
        v
Agent Control Plane
  Projects | Tasks | Agents | Runs | Memory | Policies
        |
        v
Execution Layer
  Codex | Claude Code | OpenAI BYOK | Anthropic BYOK
        |
        v
Live Console
  stream | tool calls | approvals | diffs | pause | kill | resume
```

## Product Rules

- Projects are the center of the product. A project owns business context, repos, workspaces, memories, tasks, and runs.
- Tasks are the work unit. Chat may create a task, but chat is not the product center.
- Runs are observable executions. Every meaningful agent action must be visible in the run timeline.
- Agents are profiles with runtime, instructions, tools, permissions, and model/provider selection.
- Telegram is a remote control channel. It sends short status updates, approvals, and final summaries, not raw terminal spam.
- The web console is Hermes-like: live stream, tool output, approvals, diffs, subagents, pause, kill, and resume.
- Do not add another isolated "lite" chat page. New agentic UX must fit into Projects, Tasks, Runs, Agents, or Channels.

## Primary Routes

```txt
/:team/projects
/:team/projects/:projectId
/:team/projects/:projectId/tasks
/:team/projects/:projectId/workspace
/:team/projects/:projectId/runs/:runId

/:team/agents
/:team/agents/:agentId

/:team/runs
/:team/runs/:runId

/:team/channels
/:team/channels/telegram

/:team/keys
/:team/settings
```

## Documents

- `ORCHESTRATOR.md` defines the control loop and ownership boundaries.
- `SUBAGENTS.md` defines the standard specialist agents.
- `BUILD_GUIDELINE.md` defines the rebuild phases and acceptance rules.
- `manifests/orchestrator.yaml` and `manifests/subagents.yaml` are machine-readable role contracts.
