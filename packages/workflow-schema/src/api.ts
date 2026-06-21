import { z } from "zod";
import { workflowGraph } from "./graph";
import { run, runStep } from "./run";

/** REST request/response DTOs shared by apps/web and apps/engine. */

export const createWorkflowInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowInput>;

export const saveVersionInput = z.object({
  name: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
  graph: workflowGraph,
});
export type SaveVersionInput = z.infer<typeof saveVersionInput>;

export const runWorkflowInput = z.object({
  payload: z.unknown().optional(),
});
export type RunWorkflowInput = z.infer<typeof runWorkflowInput>;

export const workflowSummary = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  currentVersion: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().nullable(),
});
export type WorkflowSummary = z.infer<typeof workflowSummary>;

export const workflowDetail = workflowSummary.extend({
  graph: workflowGraph.nullable(),
});
export type WorkflowDetail = z.infer<typeof workflowDetail>;

export const runDetail = run.extend({
  steps: z.array(runStep),
});
export type RunDetail = z.infer<typeof runDetail>;

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().optional(),
  });
