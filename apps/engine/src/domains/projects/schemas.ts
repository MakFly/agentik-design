import { z } from "zod";

export const projectTypeSchema = z.enum(["ops", "code", "hybrid"]);
export const resourceTypeSchema = z.enum(["git_repo", "local_dir", "url", "document", "tool"]);
export const taskStatusSchema = z.enum([
  "backlog",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "cancelled",
]);
export const taskPrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const createProjectBody = z.object({
  name: z.string().trim().min(1),
  type: projectTypeSchema.optional(),
  description: z.string().optional(),
  leadAgentId: z.string().nullish(),
});

export const addResourceBody = z.object({
  type: resourceTypeSchema,
  ref: z.string().trim().min(1),
  label: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const createTaskBody = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  assignedAgentId: z.string().nullish(),
  status: taskStatusSchema.optional(),
});

export const updateTaskBody = z.object({
  status: taskStatusSchema.optional(),
  assignedAgentId: z.string().nullish(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
});

export const taskCommentBody = z.object({ content: z.string().trim().min(1) });

export const runTaskBody = z.object({ instruction: z.string().optional() });

export type CreateProjectBody = z.infer<typeof createProjectBody>;
export type CreateTaskBody = z.infer<typeof createTaskBody>;
