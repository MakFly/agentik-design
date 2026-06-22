import type { ReviewAgentOutput } from "@agentik/workflow-schema";

export type ReviewInput = {
  taskId: string;
  agentId: string;
  status: string; // agent_tasks.status — "completed" | "failed" | …
  error?: string | null;
  messages: { type: string; tool?: string | null; content?: string | null }[];
};

function lastText(messages: ReviewInput["messages"]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && (m.type === "text" || m.type === "error") && m.content) return m.content;
  }
  return undefined;
}

/**
 * Deterministic, offline Review Agent — proves the learning-loop plumbing without an LLM.
 * A real LLM reviewer is a drop-in swap behind the same ReviewAgentOutput contract (§6).
 * Conservative to avoid review spam: failure → one lesson memory; success-with-tools → one
 * low-confidence note; quiet success → no proposals. It NEVER mutates memory/skills (propose-only).
 */
export function deterministicReview(input: ReviewInput): ReviewAgentOutput {
  if (input.status === "failed") {
    const reason = (input.error ?? lastText(input.messages) ?? "unknown error").slice(0, 280);
    return {
      summary: `Run ${input.taskId} failed: ${reason}`,
      riskLevel: "medium",
      shouldCreateMemory: true,
      memories: [
        {
          action: "create",
          scope: "agent",
          targetId: input.agentId,
          content: `Past run failed: ${reason}. Watch for this failure mode and verify before proceeding.`,
          reason: "Capture the failure so future runs avoid repeating it.",
          confidence: 0.6,
        },
      ],
      shouldCreateSkill: false,
      skillChanges: [],
    };
  }

  const tools = [...new Set(input.messages.filter((m) => m.type === "tool_use" && m.tool).map((m) => m.tool as string))];
  if (input.status === "completed" && tools.length > 0) {
    return {
      summary: `Run ${input.taskId} succeeded using ${tools.join(", ")}.`,
      riskLevel: "low",
      shouldCreateMemory: true,
      memories: [
        {
          action: "create",
          scope: "agent",
          targetId: input.agentId,
          content: `A working approach for this agent used: ${tools.join(", ")}.`,
          reason: "Capture a successful approach for reuse.",
          confidence: 0.5,
        },
      ],
      shouldCreateSkill: false,
      skillChanges: [],
    };
  }

  return {
    summary: `Run ${input.taskId} completed with no notable signals.`,
    riskLevel: "low",
    shouldCreateMemory: false,
    memories: [],
    shouldCreateSkill: false,
    skillChanges: [],
  };
}
