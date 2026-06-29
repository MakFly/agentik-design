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
- Route execution to the selected runner: Codex, Claude Code, OpenAI BYOK, or Anthropic BYOK.
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
- Run notifications go through a channel presenter. The run result and events
  remain structured; Telegram renders agent-facing progress, approval, failure,
  and completion summaries instead of sending raw run payloads.
- Telegram command acknowledgements use the same tone: concise operator feedback,
  explicit next action when needed, and a canonical detail link instead of raw
  status dumps.
- Telegram connections sync a native Bot API command menu with the same bounded
  operator commands as `/help`, so `/context`, `/run`, `/approve`, and the rest
  are discoverable from the Telegram UI after setup or transport changes.
- Telegram inbound messages are normalized before routing: text, captions, and
  common attachment metadata become one operator intent. Media-only messages are
  routed with attachment context instead of being silently ignored; raw file
  download/analysis is an explicit connector capability layered on top.
- Telegram replies carry conversation context. When an operator replies to a
  prior Telegram message with a free-form request like "continue with risks",
  the gateway injects the replied message into the run input instead of sending
  only the short follow-up.
- For Telegram documents that are small and text-like, the gateway may fetch the
  file through Telegram `getFile` and inject a bounded text preview into the run
  input. Binary media remains metadata-only until a runtime/tool can process it.
- Telegram group chats respect the channel binding policy. When a binding
  requires mention, Agentik ignores ambient group messages, ignores commands
  addressed to another bot, and only routes messages with a real bot mention,
  `/command@bot`, or a reply to the bot.
- Telegram forum topics are isolated conversations. The same user in the same
  group can keep different active projects/runs per `message_thread_id`, so a
  support topic cannot overwrite the state of an engineering topic.
- Approval requests sent to Telegram include typed inline actions that map back
  to the same run-control commands as `/approve` and `/reject`. Telegram remains
  a bounded operator surface, not a free-form remote shell.
- A paired Telegram chat keeps lightweight session state, including the active
  project and active run. Operators can select `/project <projectId>` once,
  then use `/context`, `/tasks`, `/run "task title"`, `/learn "fact"`, `/status`,
  `/pause`, `/resume`, `/approve ok`, and `/reject reason` without repeating
  IDs.
- `/context` is read-only. It shows the project description, open tasks,
  linked resources, and confirmed memories the orchestrator will use before an
  operator launches work.
- `/skills` is read-only. It shows the selected agent's role, goal, runtime,
  model, published version, tools, approval requirements, and instruction
  summary so operators can choose the right agent from Telegram.
