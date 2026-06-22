import { z } from "zod";
import { createdBy, knowledgeScope } from "./agent";

/** Procedural knowledge (how-to). Versioned so improvements are auditable & reversible. */
export const skill = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  description: z.string(),
  scope: knowledgeScope,
  targetId: z.string().optional(),
  currentVersionId: z.string().optional(),
  createdBy,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Skill = z.infer<typeof skill>;

export const skillVersion = z.object({
  id: z.string(),
  skillId: z.string(),
  version: z.number().int().positive(), // monotonic per skill
  bodyMd: z.string(),
  triggerConditions: z.array(z.string()),
  pitfalls: z.array(z.string()),
  verificationSteps: z.array(z.string()),
  sourceRunId: z.string().optional(),
  createdBy,
  changelog: z.string().optional(),
  createdAt: z.string(),
});
export type SkillVersion = z.infer<typeof skillVersion>;
