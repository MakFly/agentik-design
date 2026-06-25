# Multica + OpenClaw + Hermes Blueprint

This document explains the target Agentik system in practical terms. It is not a vendored copy of Multica. Multica's frontend license has extra restrictions for hosted or embedded products, so Agentik should copy the product model and workflows, not import their `apps/web` source as the base UI.

## Reference Roles

```txt
Multica
  Product model: workspace, issues/tasks, agents, runtimes, projects, activity.
  UI model: dense task board, agents as teammates, runtime health, execution log.

OpenClaw
  Control surface: local-first gateway, channels, pairing, allowlists, sessions.
  Agent model: one assistant reachable from Telegram/Slack/etc, with skills and tools.

Hermes
  Operator surface: real TUI, slash commands, skills, memory, subagents, coding delegation.
  Execution model: local/Docker/SSH/cloud terminal backends, Claude Code/Codex handoff.

Agentik
  Product target: Multica-style project/task/agent/runs control plane,
  with OpenClaw-style Telegram control and Hermes-style run console.
```

## Core Mental Model

```txt
Team
  |
  +-- Project
  |     |
  |     +-- Resources
  |     |     +-- git repo URL
  |     |     +-- docs URL
  |     |     +-- CRM / Search Console / analytics handles
  |     |
  |     +-- Memory
  |     |     +-- ICP
  |     |     +-- offer
  |     |     +-- tone
  |     |     +-- code conventions
  |     |
  |     +-- Tasks
  |           |
  |           +-- assigned Agent
  |           +-- prepared Workspace
  |           +-- observable Run
  |
  +-- Agents
  |     +-- SEO Auditor
  |     +-- Lead Researcher
  |     +-- Code Project Implementer
  |     +-- Code Reviewer
  |
  +-- Runtimes
        +-- Claude Code CLI
        +-- Codex CLI
        +-- Hermes CLI
        +-- BYOK OpenAI/Anthropic/OpenRouter
```

## The Product Flow

```txt
1. Create project
   name, client/business context, project type, repo/resources, memory.

2. Create or pick agent
   choose a template: SEO, Leads, Code, Support, Data.
   choose runtime: Claude Code, Codex, Hermes, or BYOK.
   choose tools and approval policy.

3. Create task
   "Audit villatagbao.com SEO", "Build 50 leads", "Fix admin booking bug".

4. Orchestrator prepares context
   project memory + task + selected agent prompt + resource refs + AGENTS.md.

5. Workspace is prepared
   coding task: clone repo, checkout branch, read AGENTS.md, record base state.
   business task: prepare source pack, web/CRM/search-console context.

6. Run starts
   web console shows full stream.
   Telegram receives compact milestones.

7. Risky action pauses for approval
   external writes, email sends, CRM writes, destructive shell, deploys, PRs.

8. Run completes
   artifacts: summary, evidence, files changed, tests, commands, next steps.
   confirmed learnings can become project memory.
```

## Specialized Agent Design

An agent is not just a prompt. It must define all six parts:

```txt
Agent =
  role
  goal
  runtime
  tools
  memory/context
  policy/approval rules
```

### SEO Agents

```txt
Technical SEO Auditor
  runtime: BYOK or Claude Code when codebase access is needed
  tools: web fetch, Lighthouse, Search Console, file read, shell
  memory: offer, ICP, target geography, competitors, CMS/framework
  tasks:
    - audit crawl/indexation
    - inspect route metadata
    - inspect sitemap/robots/canonicals
    - produce prioritized fixes
  approval:
    - required before editing site code
    - required before publishing content

SEO Content Strategist
  runtime: BYOK or Claude
  tools: web search, HTTP fetch, knowledge base, analytics/search data
  memory: offer, tone, proof points, target customer
  tasks:
    - keyword/page map
    - content briefs
    - internal link plan
    - title/meta/H1 outlines
  approval:
    - required before CMS publish
```

### Leads Agents

```txt
Lead Researcher
  runtime: BYOK or Claude
  tools: web search, CRM, spreadsheet, LinkedIn/enrichment connector
  memory: ICP, exclusions, regions, offer, qualification rubric
  tasks:
    - build prospect list
    - score fit and intent
    - enrich missing fields
    - prepare CRM rows
  approval:
    - required before CRM writes

Outbound Sequence Writer
  runtime: BYOK or Claude
  tools: CRM, email, LinkedIn, knowledge base
  memory: tone, offer, proof, objections, do-not-say rules
  tasks:
    - write 3-step sequence
    - personalize from verified facts
    - propose next action
  approval:
    - always required before sending
```

### Code Project Agent

```txt
Code Project Implementer
  runtime: Claude Code or Codex
  tools: git workspace, shell, file edit, test runner
  memory: repo conventions, AGENTS.md, stack, definition of done
  tasks:
    - bugfix
    - feature
    - refactor
    - migration
    - cleanup
  approval:
    - required before destructive commands
    - required before deploy
    - required before force push
    - required before opening PR if configured
```

## UI Shape

```txt
Sidebar
  Command Center
  Projects
  Runs
  Agents
  Workflows
  Tools
  Memory
  Telegram
  Observability
  Settings

Projects page
  project list, active tasks, linked resources, channels, recent runs.

Project detail
  left: context/resources/memory
  center: task board and comments
  right: active runs, workspaces, linked Telegram channels

Agents page
  dense Multica-style roster
  scopes: all, working, ready, attention
  templates: SEO, Leads, Code, Support, Data

Runs page
  dense Multica-style board
  scopes: all, active, needs review, finished

Run detail
  left: execution log
  center: Hermes-like operator console
  right: project task, artifacts, cost, metadata
```

## Telegram Control

Telegram should not be a second product. It is the remote control.

```txt
/projects
/tasks <project>
/run <task-id>
/status <run-id>
/pause <run-id>
/resume <run-id>
/approve <run-id>
/reject <run-id>
/kill <run-id>
/learn <project> <fact>
```

Rules:

- Telegram creates tasks and controls runs through the orchestrator.
- Telegram never bypasses policy.
- Telegram receives links to the canonical web run.
- Telegram receives summaries, not raw terminal spam.

## Why This Makes Coding Work

For code projects, the project resource is a git repo. A task creates a workspace:

```txt
Task: "Fix checkout redirect bug"
  |
  v
Workspace:
  git clone <repo>
  checkout agentik/<task-id>
  read AGENTS.md
  inject project memory
  run Claude Code or Codex in that directory
  collect changed files, diff stats, tests
  stream events to Run
```

The user sees:

```txt
Project -> Task -> Run
                 |
                 +-- workspace prepared
                 +-- files read
                 +-- files changed
                 +-- tests run
                 +-- approval requested
                 +-- completed summary
```

That is the missing bridge between "business agents" and "coding agents": both are tasks, but coding tasks get a cloned workspace and a CLI runner.
