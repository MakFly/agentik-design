import { schema } from "../../infra/db/client";

const { daemons, runSteps } = schema;

export type DaemonRunRowDb = typeof schema.runs.$inferSelect;
export type RunMsgRowDb = typeof schema.runMessages.$inferSelect;
export type RunRowDb = typeof schema.runs.$inferSelect;
type RunStepRowDb = typeof runSteps.$inferSelect;

export const ZERO_COST = {
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

export function runCostFromRow(
  task: Pick<DaemonRunRowDb, "result" | "costCents">,
): typeof ZERO_COST {
  const fromResult = costFromTaskResult(task.result);
  if (fromResult.money.amountCents > 0 || fromResult.tokens.total > 0) {
    return fromResult;
  }
  if (!task.costCents || task.costCents <= 0) return ZERO_COST;
  return {
    ...ZERO_COST,
    money: { amountCents: task.costCents, currency: "USD" as const },
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

/* ── Mappers ─────────────────────────────────────────────────────────── */

export function daemonRunToWeb(task: DaemonRunRowDb, agentName?: string) {
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
    status: task.status as WebRunStatus,
    trigger: {
      kind: task.kind === "direct" ? ("api" as const) : ("manual" as const),
    },
    startedAt: task.startedAt ?? task.createdAt,
    endedAt: task.endedAt,
    durationMs: task.durationMs,
    cost: runCostFromRow(task),
    traceId: task.id,
    error: task.error
      ? { kind: "unknown" as const, message: task.error, traceId: task.id }
      : undefined,
    stepCount: task.stepCount,
    completedSteps: task.completedSteps,
  };
}

export function orchestrationRunToWeb(task: RunRowDb) {
  return {
    id: task.id,
    teamId: task.teamId,
    env: "dev" as const,
    subject: {
      kind: "orchestration" as const,
      runId: task.id,
    },
    subjectName: orchestrationGoal(task.input) ?? "Orchestration",
    status: task.status as WebRunStatus,
    trigger: { kind: "manual" as const },
    startedAt: task.startedAt ?? task.createdAt,
    endedAt: task.endedAt,
    durationMs: task.durationMs,
    cost: ZERO_COST,
    traceId: task.id,
    error: task.error
      ? { kind: "unknown" as const, message: task.error, traceId: task.id }
      : undefined,
    stepCount: task.stepCount,
    completedSteps: task.completedSteps,
  };
}

export function runMessageToStep(msg: RunMsgRowDb, agentName?: string) {
  const base = {
    id: msg.id,
    runId: msg.runId,
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

export function runMessagesToSteps(messages: RunMsgRowDb[], agentName?: string) {
  const steps: ReturnType<typeof runMessageToStep>[] = [];
  const pendingTools: Array<{
    message: RunMsgRowDb;
    step: ReturnType<typeof runMessageToStep>;
  }> = [];

  for (const msg of messages) {
    if (msg.type === "tool_use") {
      const step = runMessageToStep(msg, agentName);
      steps.push(step);
      pendingTools.push({ message: msg, step });
      continue;
    }

    if (msg.type === "tool_result") {
      const matchIndex = pendingTools.findIndex(({ message }) =>
        msg.tool ? message.tool === msg.tool : true,
      );
      if (matchIndex === -1) {
        steps.push(runMessageToStep(msg, agentName));
        continue;
      }

      const [match] = pendingTools.splice(matchIndex, 1);
      if (!match) {
        steps.push(runMessageToStep(msg, agentName));
        continue;
      }
      const tool = match.message.tool ?? msg.tool ?? "tool";
      const durationMs = Math.max(
        0,
        new Date(msg.createdAt).getTime() - new Date(match.message.createdAt).getTime(),
      );
      const call = match.step.toolCalls[0];
      match.step.actor = { kind: "tool" as const, toolId: tool, name: tool };
      match.step.status = "succeeded";
      match.step.summary = `${tool} completed`;
      match.step.endedAt = msg.createdAt;
      match.step.durationMs = Number.isFinite(durationMs) ? durationMs : 0;
      match.step.toolCalls = [
        {
          id: call?.id ?? match.message.id,
          toolId: tool,
          action: tool,
          request: match.message.input ?? {},
          response: msg.output ?? undefined,
          status: "succeeded" as const,
        },
      ];
      continue;
    }

    steps.push(runMessageToStep(msg, agentName));
  }

  return steps.map((step, index) => ({ ...step, index }));
}

export function fallbackResultStep(task: DaemonRunRowDb, agentName?: string) {
  const summary = resultSummary(task.result) || task.error || "";
  if (!summary) return null;
  const ts = task.endedAt ?? task.startedAt ?? task.createdAt;
  return {
    id: `${task.id}:result`,
    runId: task.id,
    index: 0,
    actor: {
      kind: "agent" as const,
      agentId: "agt",
      name: agentName ?? "Agent",
    },
    status:
      task.status === "failed" ? ("failed" as const) : ("succeeded" as const),
    summary,
    toolCalls: [],
    startedAt: ts,
    endedAt: task.endedAt ?? ts,
    durationMs: task.durationMs ?? 0,
    cost: runCostFromRow(task),
    attempt: 1,
    ...(task.status === "failed"
      ? {
          error: {
            kind: "unknown" as const,
            code: "error",
            message: summary,
            retryable: false,
          },
        }
      : {}),
  };
}

export function workflowRunToRun(r: RunRowDb, wfName?: string) {
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

function orchestrationGoal(input: unknown): string | null {
  const root = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const orchestration = root.orchestration;
  if (!orchestration || typeof orchestration !== "object") return null;
  const goal = (orchestration as Record<string, unknown>).goal;
  return typeof goal === "string" && goal.trim() ? goal.trim() : null;
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

export function artifactsFromRun(task: DaemonRunRowDb) {
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

export function daemonDisplayName(
  daemon: Pick<typeof daemons.$inferSelect, "id" | "name" | "meta"> | null | undefined,
) {
  const meta = (daemon?.meta ?? {}) as {
    deviceName?: string;
    host?: { host?: string };
  };
  return meta.deviceName ?? meta.host?.host ?? daemon?.name ?? daemon?.id ?? null;
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

export function workflowStepToWebStep(s: RunStepRowDb) {
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
