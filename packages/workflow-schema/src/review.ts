import { z } from "zod";
import { knowledgeScope } from "./agent";

export const riskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof riskLevel>;

export const runReviewStatus = z.enum(["pending", "approved", "rejected", "applied"]);
export type RunReviewStatus = z.infer<typeof runReviewStatus>;

/** A proposed new memory entry — propose-only, applied only on human approval. */
export const proposedMemoryChange = z.object({
  action: z.literal("create"),
  scope: knowledgeScope,
  targetId: z.string().optional(),
  content: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ProposedMemoryChange = z.infer<typeof proposedMemoryChange>;

/** A proposed skill change — create a new skill or patch an existing one (→ new version). */
export const proposedSkillChange = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    skillName: z.string(),
    description: z.string(),
    scope: knowledgeScope,
    targetId: z.string().optional(),
    bodyMd: z.string(),
    triggerConditions: z.array(z.string()),
    pitfalls: z.array(z.string()),
    verificationSteps: z.array(z.string()),
    reason: z.string(),
  }),
  z.object({
    action: z.literal("patch"),
    skillId: z.string().optional(),
    skillName: z.string(),
    oldText: z.string(),
    newText: z.string(),
    reason: z.string(),
  }),
]);
export type ProposedSkillChange = z.infer<typeof proposedSkillChange>;

/** Persisted review of a finished run — the only artifact the Review Agent writes. */
export const runReview = z.object({
  id: z.string(),
  teamId: z.string(),
  runId: z.string(), // = agent_tasks.id
  status: runReviewStatus,
  summary: z.string(),
  riskLevel,
  proposedMemories: z.array(proposedMemoryChange),
  proposedSkillChanges: z.array(proposedSkillChange),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RunReview = z.infer<typeof runReview>;

/**
 * Structured output the Review Agent emits. A deterministic reviewer ships first;
 * a real LLM reviewer is a drop-in swap behind this same contract.
 */
export const reviewAgentOutput = z.object({
  summary: z.string(),
  riskLevel,
  shouldCreateMemory: z.boolean(),
  memories: z.array(proposedMemoryChange),
  shouldCreateSkill: z.boolean(),
  skillChanges: z.array(proposedSkillChange),
});
export type ReviewAgentOutput = z.infer<typeof reviewAgentOutput>;
