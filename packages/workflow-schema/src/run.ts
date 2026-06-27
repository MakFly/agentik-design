import { z } from "zod";

/** Run / step status enums — mirror apps/web/types/domain.ts. */

export const RUN_STATUSES = [
  "queued",
  "running",
  "paused",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export const runStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatus>;

export const STEP_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "retrying",
] as const;
export const stepStatus = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof stepStatus>;

export const triggerKind = z.enum(["manual", "webhook", "schedule", "api"]);
export type TriggerKind = z.infer<typeof triggerKind>;

export const runExecutor = z.enum(["workflow", "daemon"]);
export type RunExecutor = z.infer<typeof runExecutor>;

/** Daemon-side agent task status (apps/engine/src/db/schema.ts). */
export const agentTaskStatus = z.enum([
  "queued",
  "dispatched",
  "running",
  "paused",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentTaskStatus = z.infer<typeof agentTaskStatus>;

export const taskErrorReason = z.enum([
  "timeout",
  "runtime_offline",
  "runtime_recovery",
  "agent_error",
]);
export type TaskErrorReason = z.infer<typeof taskErrorReason>;

/** Map agent_tasks.status → unified run.status (completed → succeeded). */
export function mapAgentTaskStatusToRunStatus(
  status: AgentTaskStatus,
): RunStatus {
  switch (status) {
    case "queued":
    case "dispatched":
      return "queued";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "waiting_approval":
      return "waiting_approval";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

/** Alias for daemon/agent run status normalization. */
export const daemonRunStatus = mapAgentTaskStatusToRunStatus;

/** A single executed node, persisted as run_steps. */
export const runStep = z.object({
  id: z.string(),
  runId: z.string(),
  index: z.number().int(),
  nodeId: z.string(),
  nodeType: z.string(),
  label: z.string(),
  status: stepStatus,
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  attempt: z.number().int().default(1),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
});
export type RunStep = z.infer<typeof runStep>;

export const run = z.object({
  id: z.string(),
  teamId: z.string(),
  executor: runExecutor,
  workflowId: z.string().nullable(),
  versionId: z.string().nullable(),
  status: runStatus,
  trigger: triggerKind,
  payload: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  stepCount: z.number().int().default(0),
  completedSteps: z.number().int().default(0),
  agentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  projectTaskId: z.string().nullable().optional(),
  runtimeId: z.string().nullable().optional(),
  daemonId: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  kind: z.string().nullable().optional(),
  input: z.unknown().nullable().optional(),
  workDir: z.string().nullable().optional(),
  result: z.unknown().nullable().optional(),
  errorReason: taskErrorReason.nullable().optional(),
  attempt: z.number().int().optional(),
  chatSessionId: z.string().nullable().optional(),
  dispatchedAt: z.string().nullable().optional(),
});
export type Run = z.infer<typeof run>;
