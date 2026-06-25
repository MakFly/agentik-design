import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { hub } from "./hub";
import {
  createAgentVersion,
  type CreateAgentVersionInput,
} from "./learning-repo";
import {
  DEFAULT_MEMORY_POLICY,
  DEFAULT_SKILL_POLICY,
  runtimeKindSchema,
} from "@agentik/workflow-schema";
import type { AgentTaskStatus } from "./db/schema";

const {
  agents,
  daemons,
  runtimes,
  agentTasks,
  taskMessages,
  runs,
  runSteps,
  workflows,
  projects,
  projectResources,
  projectTasks,
  projectWorkspaces,
} = schema;

type AgentRowDb = typeof agents.$inferSelect;
type TaskRowDb = typeof agentTasks.$inferSelect;
type MsgRowDb = typeof taskMessages.$inferSelect;
type RunRowDb = typeof runs.$inferSelect;

async function projectContextForTask(task: TaskRowDb) {
  if (!task.projectId || !task.projectTaskId) return null;
  const [project, projectTask, resources, workspaces] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(
        and(eq(projects.teamId, task.teamId), eq(projects.id, task.projectId)),
      )
      .limit(1),
    db
      .select()
      .from(projectTasks)
      .where(
        and(
          eq(projectTasks.teamId, task.teamId),
          eq(projectTasks.id, task.projectTaskId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(projectResources)
      .where(
        and(
          eq(projectResources.teamId, task.teamId),
          eq(projectResources.projectId, task.projectId),
        ),
      )
      .orderBy(desc(projectResources.createdAt)),
    db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.teamId, task.teamId),
          eq(projectWorkspaces.projectId, task.projectId),
        ),
      )
      .orderBy(desc(projectWorkspaces.updatedAt)),
  ]);
  if (!project[0] || !projectTask[0]) return null;
  return {
    project: project[0],
    task: projectTask[0],
    resources,
    workspaces,
  };
}

/* ── Web contract shapes (mirror apps/web/types/domain.ts) ───────────── */

const ZERO_COST = {
  tokens: { input: 0, output: 0, total: 0 },
  money: { amountCents: 0, currency: "USD" as const },
};

/**
 * Real run cost from the runtime's completion result (claude reports usage +
 * total_cost_usd in its stream-json `result`). Runtimes that report nothing
 * (echo) yield a genuine zero — not a fabricated constant.
 */
function costFromTaskResult(result: unknown): typeof ZERO_COST {
  if (!result || typeof result !== "object") return ZERO_COST;
  const r = result as Record<string, unknown>;
  const usage = (
    r.usage && typeof r.usage === "object" ? r.usage : {}
  ) as Record<string, unknown>;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const output =
    typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const costUsd = typeof r.cost_usd === "number" ? r.cost_usd : 0;
  if (input === 0 && output === 0 && costUsd === 0) return ZERO_COST;
  return {
    tokens: { input, output, total: input + output },
    money: { amountCents: Math.round(costUsd * 100), currency: "USD" as const },
  };
}

export type WebRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

const TASK_TO_RUN_STATUS: Record<AgentTaskStatus, WebRunStatus> = {
  queued: "queued",
  dispatched: "queued",
  running: "running",
  paused: "paused",
  waiting_approval: "waiting_approval",
  completed: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

/* ── Mappers ─────────────────────────────────────────────────────────── */

export function agentTaskToRun(task: TaskRowDb, agentName?: string) {
  return {
    id: task.id,
    teamId: task.teamId,
    env: "dev" as const,
    subject: {
      kind: "agent" as const,
      agentId: task.agentId,
      versionId: "ver_live",
    },
    subjectName: agentName ?? task.agentId,
    status: TASK_TO_RUN_STATUS[task.status],
    trigger: {
      kind: task.kind === "direct" ? ("api" as const) : ("manual" as const),
    },
    startedAt: task.startedAt ?? task.createdAt,
    endedAt: task.endedAt,
    durationMs: task.durationMs,
    cost: costFromTaskResult(task.result),
    traceId: task.id,
    error: task.error
      ? { kind: "unknown" as const, message: task.error, traceId: task.id }
      : undefined,
    stepCount: task.stepCount,
    completedSteps: task.completedSteps,
  };
}

export function taskMessageToStep(msg: MsgRowDb, agentName?: string) {
  const base = {
    id: msg.id,
    runId: msg.taskId,
    index: msg.seq,
    startedAt: msg.createdAt,
    endedAt: msg.createdAt,
    durationMs: 0,
    cost: ZERO_COST,
    attempt: 1,
  };
  const t = msg.type;
  if (t === "tool_use" || t === "tool_result") {
    const tool = msg.tool ?? "tool";
    return {
      ...base,
      actor: { kind: "tool" as const, toolId: tool, name: tool },
      status: t === "tool_use" ? ("running" as const) : ("succeeded" as const),
      summary: t === "tool_use" ? `Calling ${tool}` : `${tool} → result`,
      toolCalls: [
        {
          id: msg.id,
          toolId: tool,
          action: tool,
          request: msg.input ?? {},
          response: msg.output ?? undefined,
          status:
            t === "tool_use" ? ("running" as const) : ("succeeded" as const),
        },
      ],
    };
  }
  return {
    ...base,
    actor: {
      kind: "agent" as const,
      agentId: "agt",
      name: agentName ?? "Agent",
    },
    status: t === "error" ? ("failed" as const) : ("succeeded" as const),
    summary: msg.content ?? (t === "thinking" ? "Thinking" : t),
    reasoning: t === "thinking" ? (msg.content ?? undefined) : undefined,
    toolCalls: [],
    ...(t === "error"
      ? {
          error: {
            kind: "unknown" as const,
            code: "error",
            message: msg.content ?? "error",
            retryable: false,
          },
        }
      : {}),
  };
}

function workflowRunToRun(r: RunRowDb, wfName?: string) {
  return {
    id: r.id,
    teamId: r.teamId,
    env: "prod" as const,
    subject: {
      kind: "workflow" as const,
      workflowId: r.workflowId,
      versionId: r.versionId,
    },
    subjectName: wfName ?? r.workflowId,
    status: r.status as WebRunStatus,
    trigger: { kind: r.trigger as "manual" | "webhook" | "schedule" | "api" },
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    cost: ZERO_COST,
    traceId: r.id,
    error: r.error
      ? { kind: "unknown" as const, message: r.error, traceId: r.id }
      : undefined,
    stepCount: r.stepCount,
    completedSteps: r.completedSteps,
  };
}

type RunStepRowDb = typeof runSteps.$inferSelect;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function resultSummary(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["result", "summary", "message"]) {
      if (typeof r[key] === "string" && r[key].trim()) return r[key].trim();
    }
  }
  return "";
}

function testsFromResult(
  result: unknown,
): Array<{ name: string; status: string; output?: string }> {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const raw = r.tests ?? r.test_results ?? r.checks;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return { name: item, status: "reported" };
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const name =
        typeof row.name === "string"
          ? row.name
          : typeof row.command === "string"
            ? row.command
            : "";
      if (!name.trim()) return null;
      return {
        name: name.trim(),
        status:
          typeof row.status === "string"
            ? row.status
            : typeof row.result === "string"
              ? row.result
              : "reported",
        ...(typeof row.output === "string" ? { output: row.output } : {}),
      };
    })
    .filter((item): item is { name: string; status: string; output?: string } =>
      Boolean(item),
    );
}

function fileChangesFromResult(result: unknown): Array<{
  path: string;
  status: string;
  additions: number;
  deletions: number;
}> {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const raw = r.file_changes ?? r.fileChanges;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const path = typeof row.path === "string" ? row.path.trim() : "";
      if (!path) return null;
      return {
        path,
        status: typeof row.status === "string" ? row.status : "changed",
        additions: typeof row.additions === "number" ? row.additions : 0,
        deletions: typeof row.deletions === "number" ? row.deletions : 0,
      };
    })
    .filter(
      (
        item,
      ): item is {
        path: string;
        status: string;
        additions: number;
        deletions: number;
      } => Boolean(item),
    );
}

function artifactsFromTask(task: TaskRowDb) {
  const result =
    task.result && typeof task.result === "object"
      ? (task.result as Record<string, unknown>)
      : null;
  const changedFiles = result
    ? stringArray(result.changed_files ?? result.changedFiles)
    : [];
  const fileChanges = fileChangesFromResult(task.result);
  const tests = testsFromResult(task.result);
  const summary = resultSummary(task.result);
  if (!changedFiles.length && !fileChanges.length && !tests.length && !summary)
    return undefined;
  return {
    summary,
    changedFiles,
    fileChanges,
    tests,
  };
}

function nodeActor(nodeType: string, nodeId: string, label: string) {
  if (nodeType === "tool")
    return { kind: "tool" as const, toolId: nodeId, name: label };
  if (nodeType === "agent")
    return { kind: "agent" as const, agentId: nodeId, name: label };
  if (["decision", "approval", "api", "code", "loop"].includes(nodeType)) {
    return {
      kind: nodeType as "decision" | "approval" | "api" | "code" | "loop",
      name: label,
    };
  }
  return { kind: "code" as const, name: label };
}

function workflowStepToWebStep(s: RunStepRowDb) {
  return {
    id: s.id,
    runId: s.runId,
    index: s.index,
    nodeId: s.nodeId,
    actor: nodeActor(s.nodeType, s.nodeId, s.label),
    status: s.status,
    summary: s.label,
    toolCalls: [],
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.durationMs,
    cost: ZERO_COST,
    attempt: s.attempt,
    ...(s.error
      ? {
          error: {
            kind: "unknown" as const,
            code: "error",
            message: s.error,
            retryable: false,
          },
        }
      : {}),
  };
}

/** Re-shape the engine's flat workflow RunDetail into the web's {run, steps}. */
export function workflowDetailToWeb(
  detail: RunRowDb & { steps: RunStepRowDb[] },
  wfName?: string,
) {
  const { steps, ...run } = detail;
  return {
    run: workflowRunToRun(run, wfName),
    steps: steps.map(workflowStepToWebStep),
  };
}

/* ── Agent-task live SSE source (real EventEnvelope stream) ──────────────
 * Replaces the web's mock `/runs/:id/stream` route. Each task_message becomes
 * one step (id = msg.id, index = msg.seq), mirroring taskMessageToStep so the
 * live timeline and the REST snapshot stay structurally identical. The events
 * match apps/web/types/events.ts (RunEvent) and drive its event-reducer 1:1. */

type LiveStepActor =
  | { kind: "agent"; agentId: string; name: string }
  | { kind: "tool"; toolId: string; name: string };

/** Subset of apps/web RunEvent that the agent-task stream emits. */
export type LiveRunEvent =
  | { type: "run.status.changed"; status: WebRunStatus }
  | {
      type: "step.started";
      step: {
        id: string;
        index: number;
        actor: LiveStepActor;
        summary: string;
      };
    }
  | {
      type: "step.completed";
      stepId: string;
      status: "succeeded" | "skipped";
      durationMs: number;
      cost: typeof ZERO_COST;
      summary: string;
    }
  | {
      type: "step.failed";
      stepId: string;
      error: {
        kind: "unknown";
        code: string;
        message: string;
        retryable: boolean;
      };
    }
  | { type: "reasoning.delta"; stepId: string; textDelta: string }
  | {
      type: "tool_call.started";
      stepId: string;
      call: { id: string; toolId: string; action: string; request: unknown };
    }
  | {
      type: "tool_call.completed";
      stepId: string;
      callId: string;
      status: "succeeded" | "failed";
      response?: unknown;
      latencyMs: number;
    }
  | { type: "stream.error"; kind: "unknown"; message: string; fatal: boolean };

export type OrchestratorRunEvent =
  | "run.started"
  | "workspace.prepared"
  | "message.created"
  | "tool.started"
  | "tool.output"
  | "approval.requested"
  | "approval.resolved"
  | "file.changed"
  | "test.started"
  | "test.finished"
  | "subagent.started"
  | "subagent.finished"
  | "run.paused"
  | "run.resumed"
  | "run.cancelled"
  | "run.failed"
  | "run.completed"
  | "memory.proposed";

export function contractEventForStatus(
  status: WebRunStatus,
): OrchestratorRunEvent | undefined {
  switch (status) {
    case "running":
      return "run.started";
    case "paused":
      return "run.paused";
    case "waiting_approval":
      return "approval.requested";
    case "cancelled":
      return "run.cancelled";
    case "failed":
    case "timed_out":
      return "run.failed";
    case "succeeded":
      return "run.completed";
    default:
      return undefined;
  }
}

export function contractEventForTaskMessage(
  msg: MsgRowDb,
  ev: LiveRunEvent,
): OrchestratorRunEvent | undefined {
  if (msg.type === "tool_use") return "tool.started";
  if (msg.type === "tool_result") {
    if (msg.tool === "workspace.prepare" && ev.type === "step.completed")
      return "workspace.prepared";
    return ev.type === "step.completed" ? "tool.output" : undefined;
  }
  if (msg.type === "error")
    return ev.type === "step.failed" ? "run.failed" : undefined;
  if (msg.type === "text")
    return ev.type === "step.completed" ? "message.created" : undefined;
  if (msg.type === "thinking")
    return ev.type === "reasoning.delta" ? "message.created" : undefined;
  return undefined;
}

/** Map one persisted task_message to its live event sequence (mirrors taskMessageToStep). */
export function agentTaskMessageToEvents(
  msg: MsgRowDb,
  agentName?: string,
): LiveRunEvent[] {
  const stepId = msg.id;
  const index = msg.seq;
  const agentActor: LiveStepActor = {
    kind: "agent",
    agentId: "agt",
    name: agentName ?? "Agent",
  };

  if (msg.type === "tool_use") {
    const tool = msg.tool ?? "tool";
    return [
      {
        type: "step.started",
        step: {
          id: stepId,
          index,
          actor: { kind: "tool", toolId: tool, name: tool },
          summary: `Calling ${tool}`,
        },
      },
      {
        type: "tool_call.started",
        stepId,
        call: {
          id: stepId,
          toolId: tool,
          action: tool,
          request: msg.input ?? {},
        },
      },
    ];
  }
  if (msg.type === "tool_result") {
    const tool = msg.tool ?? "tool";
    return [
      {
        type: "step.started",
        step: {
          id: stepId,
          index,
          actor: { kind: "tool", toolId: tool, name: tool },
          summary: `${tool} → result`,
        },
      },
      {
        type: "tool_call.started",
        stepId,
        call: { id: stepId, toolId: tool, action: tool, request: {} },
      },
      {
        type: "tool_call.completed",
        stepId,
        callId: stepId,
        status: "succeeded",
        response: msg.output ?? undefined,
        latencyMs: 0,
      },
      {
        type: "step.completed",
        stepId,
        status: "succeeded",
        durationMs: 0,
        cost: ZERO_COST,
        summary: `${tool} → result`,
      },
    ];
  }
  if (msg.type === "error") {
    return [
      {
        type: "step.started",
        step: {
          id: stepId,
          index,
          actor: agentActor,
          summary: msg.content ?? "error",
        },
      },
      {
        type: "step.failed",
        stepId,
        error: {
          kind: "unknown",
          code: "error",
          message: msg.content ?? "error",
          retryable: false,
        },
      },
    ];
  }
  // text | thinking
  const summary =
    msg.content ?? (msg.type === "thinking" ? "Thinking" : msg.type);
  const events: LiveRunEvent[] = [
    {
      type: "step.started",
      step: { id: stepId, index, actor: agentActor, summary },
    },
  ];
  if (msg.type === "thinking" && msg.content)
    events.push({ type: "reasoning.delta", stepId, textDelta: msg.content });
  events.push({
    type: "step.completed",
    stepId,
    status: "succeeded",
    durationMs: 0,
    cost: ZERO_COST,
    summary,
  });
  return events;
}

/** Live status for an agent task, tenancy-scoped. null = not found. */
export async function getAgentTaskStatus(
  teamId: string,
  id: string,
): Promise<WebRunStatus | null> {
  const [t] = await db
    .select({ status: agentTasks.status })
    .from(agentTasks)
    .where(and(eq(agentTasks.id, id), eq(agentTasks.teamId, teamId)))
    .limit(1);
  return t ? TASK_TO_RUN_STATUS[t.status] : null;
}

/** Display name of the agent behind a task, for live step actors. */
export async function getAgentTaskName(
  teamId: string,
  id: string,
): Promise<string | undefined> {
  const [t] = await db
    .select({ agentId: agentTasks.agentId })
    .from(agentTasks)
    .where(and(eq(agentTasks.id, id), eq(agentTasks.teamId, teamId)))
    .limit(1);
  if (!t) return undefined;
  const [a] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, t.agentId), eq(agents.teamId, teamId)))
    .limit(1);
  return a?.name ?? undefined;
}

/** New task_messages with seq > afterSeq, ordered — the live tail since the last cursor. */
export async function listTaskMessagesAfter(
  taskId: string,
  afterSeq: number,
): Promise<MsgRowDb[]> {
  return db
    .select()
    .from(taskMessages)
    .where(and(eq(taskMessages.taskId, taskId), gt(taskMessages.seq, afterSeq)))
    .orderBy(taskMessages.seq);
}

/* ── Dev seed (idempotent) ───────────────────────────────────────────── */

const SEED_AGENTS = [
  {
    name: "Triage Agent",
    role: "Classifier",
    goal: "Route incoming tickets",
    runtimeKind: "echo",
  },
  {
    name: "Resolve Agent",
    role: "Resolver",
    goal: "Answer and close tickets",
    runtimeKind: "echo",
  },
  {
    name: "Scraper",
    role: "Collector",
    goal: "Extract data from pages",
    runtimeKind: "echo",
  },
];

/**
 * Populate a LEGACY dev team (one with no real org membership, e.g. the mock "acme")
 * with demo agents so the dev UI isn't empty. Real onboarded orgs always have ≥1
 * member (the owner) and are left EMPTY so the first-run empty states show and the
 * "zero mocked data" acceptance holds.
 */
export async function ensureDevAgents(teamId: string): Promise<void> {
  const [member] = await db
    .select({ id: schema.orgMembers.id })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.teamId, teamId))
    .limit(1);
  if (member) return; // real org — never seed mock data
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.teamId, teamId))
    .limit(1);
  if (existing[0]) return;
  await db.insert(agents).values(
    SEED_AGENTS.map((a) => ({
      id: genId("agt"),
      teamId,
      name: a.name,
      role: a.role,
      goal: a.goal,
      runtimeKind: a.runtimeKind,
      health: "idle" as const,
    })),
  );
}

/* ── Agents list + presence ──────────────────────────────────────────── */

function agentModel(a: AgentRowDb): string {
  const cfg = a.config as { model?: { model?: string } } | null;
  return cfg?.model?.model ?? a.runtimeKind;
}

export async function listAgentRows(teamId: string) {
  await ensureDevAgents(teamId);
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.teamId, teamId))
    .orderBy(desc(agents.updatedAt));
  const tasks = await db
    .select({
      agentId: agentTasks.agentId,
      status: agentTasks.status,
      durationMs: agentTasks.durationMs,
      createdAt: agentTasks.createdAt,
    })
    .from(agentTasks)
    .where(eq(agentTasks.teamId, teamId));

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  return rows.map((a) => {
    const mine = tasks.filter((t) => t.agentId === a.id);
    const completed = mine.filter((t) => t.status === "completed");
    const failed = mine.filter((t) => t.status === "failed");
    const finished = completed.length + failed.length;
    const durations = completed
      .map((t) => t.durationMs ?? 0)
      .filter((d) => d > 0);
    const lastRunAt = mine.reduce<string | null>(
      (max, t) => (!max || t.createdAt > max ? t.createdAt : max),
      null,
    );
    return {
      id: a.id,
      teamId: a.teamId,
      name: a.name,
      role: a.role,
      goal: a.goal,
      description: a.description ?? undefined,
      tags: a.tags,
      owner: "usr_system",
      health: a.health,
      liveVersionId: a.liveVersionId,
      draftVersionId: a.draftVersionId,
      stats: {
        lastRunAt,
        successRate: finished ? completed.length / finished : 0,
        avgLatencyMs: durations.length
          ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
          : 0,
        avgCost: { amountCents: 0, currency: "USD" as const },
        runs24h: mine.filter((t) => t.createdAt >= dayAgo).length,
      },
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      createdBy: "usr_system",
      model: agentModel(a),
    };
  });
}

/** Single aggregate that backs live agent presence (availability × workload). */
export async function getAgentTaskSnapshot(teamId: string) {
  await ensureDevAgents(teamId);
  const [agentRows, daemonRows, runtimeRows, activeTasks] = await Promise.all([
    db
      .select({
        id: agents.id,
        name: agents.name,
        runtimeKind: agents.runtimeKind,
        maxConcurrentTasks: agents.maxConcurrentTasks,
        health: agents.health,
      })
      .from(agents)
      .where(eq(agents.teamId, teamId)),
    db
      .select({
        id: daemons.id,
        name: daemons.name,
        status: daemons.status,
        lastHeartbeatAt: daemons.lastHeartbeatAt,
      })
      .from(daemons)
      .where(eq(daemons.teamId, teamId)),
    db
      .select({
        id: runtimes.id,
        daemonId: runtimes.daemonId,
        kind: runtimes.kind,
        status: runtimes.status,
      })
      .from(runtimes)
      .where(eq(runtimes.teamId, teamId)),
    db
      .select({
        id: agentTasks.id,
        agentId: agentTasks.agentId,
        status: agentTasks.status,
      })
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.teamId, teamId),
          inArray(agentTasks.status, ["queued", "dispatched", "running"]),
        ),
      ),
  ]);
  return {
    agents: agentRows,
    daemons: daemonRows,
    runtimes: runtimeRows,
    activeTasks,
  };
}

/* ── System info (daemons, runtimes, detected CLIs) ──────────────────── */

export async function getSystemInfo(teamId: string) {
  const [daemonRows, runtimeRows] = await Promise.all([
    db.select().from(daemons).where(eq(daemons.teamId, teamId)),
    db
      .select({
        id: runtimes.id,
        daemonId: runtimes.daemonId,
        kind: runtimes.kind,
        status: runtimes.status,
      })
      .from(runtimes)
      .where(eq(runtimes.teamId, teamId)),
  ]);
  // Derive liveness from heartbeat freshness (daemon beats every ~5s).
  const STALE_MS = 15_000;
  const now = Date.now();
  const liveStatus = (hb: string | null): "online" | "offline" => {
    if (!hb) return "offline";
    // Postgres emits a 2-digit offset ("+00"); Date.parse needs "+00:00".
    const ts = Date.parse(
      hb.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
    );
    return !Number.isNaN(ts) && now - ts <= STALE_MS ? "online" : "offline";
  };
  // A runtime is *available* (selectable for a new agent) when its daemon is online AND
  // the backing CLI is actually present on that host. `echo` is self-contained; kinds we
  // don't probe (custom/openai/…) are trusted from the daemon's own registration.
  const onlineDaemonIds = new Set(
    daemonRows
      .filter((d) => liveStatus(d.lastHeartbeatAt) === "online")
      .map((d) => d.id),
  );
  const toolsByDaemon = new Map<string, Map<string, boolean>>();
  for (const d of daemonRows) {
    const tools =
      (d.meta as { tools?: Array<{ name: string; available: boolean }> } | null)
        ?.tools ?? [];
    toolsByDaemon.set(d.id, new Map(tools.map((t) => [t.name, t.available])));
  }
  const availableRuntimes = [
    ...new Set(
      runtimeRows
        .filter((rt) => {
          if (!onlineDaemonIds.has(rt.daemonId)) return false;
          const probed = toolsByDaemon.get(rt.daemonId)?.get(rt.kind);
          return rt.kind === "echo" || probed === undefined || probed === true;
        })
        .map((rt) => rt.kind),
    ),
  ].sort();

  return {
    daemons: daemonRows.map((d) => ({
      id: d.id,
      name: d.name,
      status: liveStatus(d.lastHeartbeatAt),
      lastHeartbeatAt: d.lastHeartbeatAt,
      meta: d.meta ?? {},
      mode: ((d.meta as { mode?: string } | null)?.mode ?? "org") as
        | "personal"
        | "org"
        | "legacy",
    })),
    runtimes: runtimeRows,
    availableRuntimes,
  };
}

/* ── Runs (union: workflow runs ⨄ agent tasks) ───────────────────────── */

export async function listRunsUnion(
  teamId: string,
  filters: { status?: string; agentId?: string },
) {
  // Agent tasks
  const taskWheres = [eq(agentTasks.teamId, teamId)];
  if (filters.agentId) taskWheres.push(eq(agentTasks.agentId, filters.agentId));
  const tasks = await db
    .select()
    .from(agentTasks)
    .where(and(...taskWheres))
    .orderBy(desc(agentTasks.createdAt))
    .limit(200);
  const agentNames = await agentNameMap(teamId);
  let items: Array<
    ReturnType<typeof agentTaskToRun> | ReturnType<typeof workflowRunToRun>
  > = tasks.map((t) => agentTaskToRun(t, agentNames.get(t.agentId)));

  // Workflow runs (skip when filtering by agentId — those are agent-only)
  if (!filters.agentId) {
    const wfRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.teamId, teamId))
      .orderBy(desc(runs.startedAt))
      .limit(200);
    const wfNames = await workflowNameMap(teamId);
    items = items.concat(
      wfRuns.map((r) => workflowRunToRun(r, wfNames.get(r.workflowId))),
    );
  }

  if (filters.status) items = items.filter((r) => r.status === filters.status);
  items.sort((a, b) =>
    b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0,
  );
  return items;
}

/** Branch on id prefix: workflow run vs agent task. Tenancy-scoped by teamId. */
export async function getRunUnified(teamId: string, id: string) {
  if (id.startsWith("atask_")) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(and(eq(agentTasks.id, id), eq(agentTasks.teamId, teamId)))
      .limit(1);
    if (!task) return null;
    const msgs = await db
      .select()
      .from(taskMessages)
      .where(eq(taskMessages.taskId, id))
      .orderBy(taskMessages.seq);
    const names = await agentNameMap(task.teamId);
    const name = names.get(task.agentId);
    const projectContext = await projectContextForTask(task);
    const artifacts = artifactsFromTask(task);
    return {
      run: agentTaskToRun(task, name),
      steps: msgs.map((m) => taskMessageToStep(m, name)),
      ...(artifacts ? { artifacts } : {}),
      ...(projectContext ? { projectContext } : {}),
    };
  }
  return null; // workflow runs handled by the existing getRun() in repo.ts
}

async function agentNameMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function workflowNameMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(eq(workflows.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/* ── Agent CRUD + test run ───────────────────────────────────────────── */

export async function createAgent(
  teamId: string,
  input: { name: string; role?: string; goal?: string; tags?: string[] },
) {
  const id = genId("agt");
  const draftVersionId = genId("ver");
  await db.insert(agents).values({
    id,
    teamId,
    name: input.name,
    role: input.role ?? "",
    goal: input.goal ?? "",
    tags: input.tags ?? [],
    draftVersionId,
    health: "idle",
  });
  return { id, draftVersionId };
}

/** Map the web's free-form config jsonb onto an immutable version's typed fields. */
function configToVersionInput(
  config: unknown,
  fallbackRuntime: string,
): CreateAgentVersionInput {
  const cfg = (config && typeof config === "object" ? config : {}) as Record<
    string,
    unknown
  >;
  const m = cfg.model;
  const model =
    typeof m === "string"
      ? m
      : m &&
          typeof m === "object" &&
          typeof (m as { model?: unknown }).model === "string"
        ? (m as { model: string }).model
        : undefined;
  const rk = runtimeKindSchema.safeParse(cfg.runtimeKind ?? fallbackRuntime);
  return {
    model,
    // The web builder stores the agent's system prompt as `systemPrompt`; older/direct
    // callers may send `instructions`. Accept either so the persona actually reaches the
    // published version (and thus the runtime via claimTask) — without it, the agent's
    // "skill" is silently dropped at publish.
    instructions:
      typeof cfg.systemPrompt === "string"
        ? cfg.systemPrompt
        : typeof cfg.instructions === "string"
          ? cfg.instructions
          : "",
    tools: Array.isArray(cfg.tools)
      ? cfg.tools.filter((t): t is string => typeof t === "string")
      : [],
    runtimeKind: rk.success ? rk.data : "echo",
    memoryPolicy: DEFAULT_MEMORY_POLICY,
    skillPolicy: DEFAULT_SKILL_POLICY,
    createdBy: "user",
  };
}

/** Publish → write an IMMUTABLE agent_versions row (monotonic), repoint liveVersionId. */
export async function publishAgent(
  teamId: string,
  agentId: string,
  config: unknown,
  changelog?: string,
) {
  const [agent] = await db
    .select({ runtimeKind: agents.runtimeKind })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  const versionInput = configToVersionInput(config, agent.runtimeKind);
  const created = await createAgentVersion(teamId, agentId, {
    ...versionInput,
    changelog,
  });
  if (!created) return null;
  // Point liveVersionId at the immutable version AND sync the agent's runtime_kind to the
  // published version — claimTask matches tasks to runtimes on agents.runtime_kind, so a
  // claude version must flip the agent off "echo" or the wrong runtime would claim its runs.
  await db
    .update(agents)
    .set({
      liveVersionId: created.id,
      runtimeKind: versionInput.runtimeKind,
      config: (config ?? {}) as Record<string, unknown>,
      health: "healthy",
      updatedAt: sql`now()`,
    })
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)));
  return {
    versionId: created.id,
    version: created.version,
    status: "published" as const,
  };
}

/**
 * Enqueue a real run of a PUBLISHED agent (Golden Path step 3). A daemon advertising the
 * agent's runtime claims it and the engine injects the agent's approved memory/skills into
 * the task at claim time. Returns {error} if the agent isn't published yet.
 */
export async function runAgent(teamId: string, agentId: string, input: string) {
  const [agent] = await db
    .select({ id: agents.id, liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  if (!agent.liveVersionId) return { error: "not_published" as const };
  const taskId = genId("atask");
  await db.insert(agentTasks).values({
    id: taskId,
    teamId,
    agentId,
    status: "queued",
    kind: "chat",
    input: { prompt: input },
  });
  hub.publish(teamId, { kind: "run", action: "created", runId: taskId });
  return { runId: taskId };
}

/** Create a queued sandbox task and return its id as a runId. The runtime
 * (echo|claude) selects which daemon runtime picks it up. */
export async function createTestTask(
  teamId: string,
  config: unknown,
  input: string,
  runtime = "echo",
) {
  await ensureDevAgents(teamId);
  // Per-team, per-runtime sandbox agent so the task is claimable by that runtime.
  const name = `Sandbox (${runtime})`;
  let [sandbox] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.name, name)))
    .limit(1);
  if (!sandbox) {
    const id = genId("agt");
    [sandbox] = await db
      .insert(agents)
      .values({
        id,
        teamId,
        name,
        role: "Test",
        goal: "Sandbox test runs",
        runtimeKind: runtime,
        health: "idle",
      })
      .returning();
  }
  const taskId = genId("atask");
  await db.insert(agentTasks).values({
    id: taskId,
    teamId,
    agentId: sandbox!.id,
    status: "queued",
    kind: "direct",
    input: { prompt: input, config },
  });
  hub.publish(teamId, { kind: "run", action: "created", runId: taskId });
  return { runId: taskId };
}

/** Cancel an agent task (workflow runs handled elsewhere). Tenancy-scoped. Returns true if flipped. */
export async function cancelAgentTask(
  teamId: string,
  id: string,
): Promise<boolean> {
  if (!id.startsWith("atask_")) return false;
  const updated = await db
    .update(agentTasks)
    .set({ status: "cancelled", endedAt: sql`now()` })
    .where(
      and(
        eq(agentTasks.id, id),
        eq(agentTasks.teamId, teamId),
        inArray(agentTasks.status, [
          "queued",
          "dispatched",
          "running",
          "paused",
          "waiting_approval",
        ]),
      ),
    )
    .returning({
      id: agentTasks.id,
      teamId: agentTasks.teamId,
      projectTaskId: agentTasks.projectTaskId,
    });
  if (!updated[0]) return false;
  await appendRunControlMessage(teamId, id, "Run cancelled by operator.");
  if (updated[0].projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, updated[0].projectTaskId),
          eq(projectTasks.teamId, updated[0].teamId),
        ),
      );
  }
  hub.publish(updated[0].teamId, {
    kind: "run",
    action: "cancelled",
    runId: id,
  });
  return true;
}

async function nextTaskMessageSeq(taskId: string) {
  const rows = (await db.execute(sql`
    SELECT coalesce(max(seq) + 1, 0)::int AS "nextSeq"
    FROM ${taskMessages}
    WHERE task_id = ${taskId}
  `)) as unknown as Array<{ nextSeq: number }>;
  return rows[0]?.nextSeq ?? 0;
}

async function appendRunControlMessage(
  teamId: string,
  taskId: string,
  content: string,
  input?: Record<string, unknown>,
) {
  const seq = await nextTaskMessageSeq(taskId);
  await db.insert(taskMessages).values({
    id: genId("amsg"),
    taskId,
    seq,
    type: "text",
    tool: "run.control",
    content,
    input: input ?? null,
  });
  await db
    .update(agentTasks)
    .set({ stepCount: seq + 1, completedSteps: seq + 1 })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.teamId, teamId)));
  hub.publish(teamId, {
    kind: "run.progress",
    runId: taskId,
    completedSteps: seq + 1,
    stepCount: seq + 1,
  });
}

export async function pauseAgentTask(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  if (!id.startsWith("atask_")) return false;
  const updated = await db
    .update(agentTasks)
    .set({ status: "paused" })
    .where(
      and(
        eq(agentTasks.id, id),
        eq(agentTasks.teamId, teamId),
        eq(agentTasks.status, "queued"),
      ),
    )
    .returning({ id: agentTasks.id, teamId: agentTasks.teamId });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Run paused: ${reason}` : "Run paused by operator.",
    { action: "pause", reason },
  );
  hub.publish(teamId, { kind: "run", action: "paused", runId: id });
  return true;
}

export async function resumeAgentTask(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  if (!id.startsWith("atask_")) return false;
  const updated = await db
    .update(agentTasks)
    .set({ status: "queued" })
    .where(
      and(
        eq(agentTasks.id, id),
        eq(agentTasks.teamId, teamId),
        eq(agentTasks.status, "paused"),
      ),
    )
    .returning({ id: agentTasks.id, teamId: agentTasks.teamId });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Run resumed: ${reason}` : "Run resumed by operator.",
    { action: "resume", reason },
  );
  hub.publish(teamId, { kind: "run", action: "created", runId: id });
  return true;
}

export async function requestAgentTaskApproval(
  teamId: string,
  id: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<boolean> {
  if (!id.startsWith("atask_")) return false;
  const updated = await db
    .update(agentTasks)
    .set({ status: "waiting_approval" })
    .where(
      and(
        eq(agentTasks.id, id),
        eq(agentTasks.teamId, teamId),
        inArray(agentTasks.status, ["queued", "paused"]),
      ),
    )
    .returning({ id: agentTasks.id, teamId: agentTasks.teamId });
  if (!updated[0]) return false;
  await appendRunControlMessage(teamId, id, `Approval requested: ${message}`, {
    action: "approval.requested",
    context: context ?? {},
  });
  hub.publish(teamId, { kind: "run", action: "waiting_approval", runId: id });
  return true;
}

export async function approveAgentTask(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  if (!id.startsWith("atask_")) return false;
  const [task] = await db
    .select({
      input: agentTasks.input,
      projectTaskId: agentTasks.projectTaskId,
    })
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.id, id),
        eq(agentTasks.teamId, teamId),
        eq(agentTasks.status, "waiting_approval"),
      ),
    )
    .limit(1);
  if (!task) return false;
  const input = (
    task.input && typeof task.input === "object" ? task.input : {}
  ) as Record<string, unknown>;
  const approval = (
    input.approval && typeof input.approval === "object" ? input.approval : {}
  ) as Record<string, unknown>;
  const updatedInput = {
    ...input,
    approval: {
      ...approval,
      approved: true,
      approvedAt: new Date().toISOString(),
      reason: reason ?? "",
    },
  };
  const updated = await db
    .update(agentTasks)
    .set({ status: "queued", input: updatedInput })
    .where(
      and(
        eq(agentTasks.id, id),
        eq(agentTasks.teamId, teamId),
        eq(agentTasks.status, "waiting_approval"),
      ),
    )
    .returning({
      id: agentTasks.id,
      teamId: agentTasks.teamId,
      projectTaskId: agentTasks.projectTaskId,
    });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Approval granted: ${reason}` : "Approval granted.",
    { action: "approval.approved", reason },
  );
  if (updated[0].projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "running", updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, updated[0].projectTaskId),
          eq(projectTasks.teamId, updated[0].teamId),
        ),
      );
  }
  hub.publish(teamId, { kind: "run", action: "created", runId: id });
  return true;
}

export async function rejectAgentTask(
  teamId: string,
  id: string,
  reason?: string,
): Promise<boolean> {
  if (!id.startsWith("atask_")) return false;
  const updated = await db
    .update(agentTasks)
    .set({ status: "cancelled", endedAt: sql`now()` })
    .where(
      and(
        eq(agentTasks.id, id),
        eq(agentTasks.teamId, teamId),
        eq(agentTasks.status, "waiting_approval"),
      ),
    )
    .returning({
      id: agentTasks.id,
      teamId: agentTasks.teamId,
      projectTaskId: agentTasks.projectTaskId,
    });
  if (!updated[0]) return false;
  await appendRunControlMessage(
    teamId,
    id,
    reason ? `Approval rejected: ${reason}` : "Approval rejected.",
    { action: "approval.rejected", reason },
  );
  if (updated[0].projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, updated[0].projectTaskId),
          eq(projectTasks.teamId, updated[0].teamId),
        ),
      );
  }
  hub.publish(teamId, { kind: "run", action: "cancelled", runId: id });
  return true;
}

/**
 * Manually re-run a finished task: enqueues a FRESH task (new id, attempt=1) copying
 * the original agent/kind/input, so the user gets a clean run with its own transcript.
 * Unlike auto-retry (which reuses the row), this never inherits a session and has no
 * attempt ceiling. Tenancy-scoped. Returns the new run id, or null if not found.
 */
export async function retryAgentTask(
  teamId: string,
  id: string,
): Promise<{ runId: string } | null> {
  if (!id.startsWith("atask_")) return null;
  const [orig] = await db
    .select({
      agentId: agentTasks.agentId,
      kind: agentTasks.kind,
      priority: agentTasks.priority,
      input: agentTasks.input,
      projectId: agentTasks.projectId,
      projectTaskId: agentTasks.projectTaskId,
    })
    .from(agentTasks)
    .where(and(eq(agentTasks.id, id), eq(agentTasks.teamId, teamId)))
    .limit(1);
  if (!orig) return null;
  const newId = genId("atask");
  await db.insert(agentTasks).values({
    id: newId,
    teamId,
    agentId: orig.agentId,
    projectId: orig.projectId,
    projectTaskId: orig.projectTaskId,
    status: "queued",
    kind: orig.kind,
    priority: orig.priority,
    input: orig.input as Record<string, unknown> | null,
  });
  if (orig.projectTaskId) {
    await db
      .update(projectTasks)
      .set({ status: "running", lastRunId: newId, updatedAt: sql`now()` })
      .where(
        and(
          eq(projectTasks.id, orig.projectTaskId),
          eq(projectTasks.teamId, teamId),
        ),
      );
  }
  hub.publish(teamId, { kind: "run", action: "created", runId: newId });
  return { runId: newId };
}
