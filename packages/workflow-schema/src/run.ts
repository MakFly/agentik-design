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
  workflowId: z.string(),
  versionId: z.string(),
  status: runStatus,
  trigger: triggerKind,
  payload: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  stepCount: z.number().int().default(0),
  completedSteps: z.number().int().default(0),
});
export type Run = z.infer<typeof run>;
