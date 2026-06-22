import { z } from "zod";
import { runtimeKindSchema } from "./runtime";

/** Knowledge scope shared by memory & skills. "workflow" allowed but unused in MVP (n8n parked). */
export const knowledgeScope = z.enum(["team", "project", "agent", "workflow"]);
export type KnowledgeScope = z.infer<typeof knowledgeScope>;

/** Injection scope — policies never inject "workflow"-scoped knowledge in the MVP. */
export const injectableScope = z.enum(["team", "project", "agent"]);
export type InjectableScope = z.infer<typeof injectableScope>;

export const createdBy = z.enum(["user", "system", "review_agent"]);
export type CreatedBy = z.infer<typeof createdBy>;

/** Bounds how much memory is injected into a run's context — no unbounded growth. */
export const memoryPolicy = z.object({
  inject: z.boolean(),
  scopes: z.array(injectableScope),
  maxEntries: z.number().int().nonnegative(),
  minConfidence: z.number().min(0).max(1),
});
export type MemoryPolicy = z.infer<typeof memoryPolicy>;

export const skillPolicy = z.object({
  inject: z.boolean(),
  scopes: z.array(injectableScope),
  maxSkills: z.number().int().nonnegative(),
});
export type SkillPolicy = z.infer<typeof skillPolicy>;

/** Immutable, versioned agent config. Fills the real gap (`agent_versions`). */
export const agentVersion = z.object({
  id: z.string(),
  agentId: z.string(),
  version: z.number().int().positive(), // monotonic per agent
  model: z.string().optional(),
  instructions: z.string(),
  tools: z.array(z.string()),
  runtimeKind: runtimeKindSchema,
  memoryPolicy,
  skillPolicy,
  createdBy,
  changelog: z.string().optional(),
  createdAt: z.string(), // ISO 8601 in data; display dd-mm-yyyy
});
export type AgentVersion = z.infer<typeof agentVersion>;

/** Sensible defaults when an agent is first published and no policy is supplied. */
export const DEFAULT_MEMORY_POLICY: MemoryPolicy = {
  inject: true,
  scopes: ["agent", "team"],
  maxEntries: 20,
  minConfidence: 0.5,
};
export const DEFAULT_SKILL_POLICY: SkillPolicy = {
  inject: true,
  scopes: ["agent", "team"],
  maxSkills: 10,
};
