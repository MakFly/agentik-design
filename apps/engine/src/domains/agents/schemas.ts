import { z } from "zod";

/**
 * Agent config is the web builder's free-form jsonb (model, systemPrompt, tools,
 * runtimeBinding, …). It is normalised at publish time by configToVersionInput, so we
 * accept it opaquely here rather than re-deriving the builder's evolving shape.
 */
const agentConfig = z.unknown();

export const createAgentBody = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(200).optional(),
  goal: z.string().trim().max(2000).optional(),
  description: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  emoji: z.string().trim().max(16).optional(),
  color: z.string().trim().max(32).optional(),
  avatarUrl: z.string().trim().url().max(2000).optional(),
  isOrchestrator: z.boolean().optional(),
  config: agentConfig.optional(),
});

export const updateAgentBody = createAgentBody.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: "Provide at least one field to update" },
);

export const rosterBody = z.object({
  subagents: z.array(
    z.object({
      agentId: z.string().trim().min(1),
      instruction: z.string().trim().max(2000).optional(),
      position: z.number().int().min(0).optional(),
    }),
  ),
});

export type CreateAgentBody = z.infer<typeof createAgentBody>;
export type UpdateAgentBody = z.infer<typeof updateAgentBody>;
export type RosterBody = z.infer<typeof rosterBody>;
