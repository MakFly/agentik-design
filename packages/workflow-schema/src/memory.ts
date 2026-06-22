import { z } from "zod";
import { createdBy, knowledgeScope } from "./agent";

/** Declarative knowledge — a fact/preference learned from a run, injected into future runs. */
export const memoryEntry = z.object({
  id: z.string(),
  teamId: z.string(),
  scope: knowledgeScope,
  targetId: z.string().optional(),
  content: z.string(),
  sourceRunId: z.string().optional(), // = agent_tasks.id
  confidence: z.number().min(0).max(1),
  createdBy,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryEntry = z.infer<typeof memoryEntry>;
