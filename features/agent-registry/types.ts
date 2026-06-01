import type { Agent } from "@/types/domain";

/** Registry row = agent + denormalized live-version model for the table. */
export interface AgentRow extends Agent {
  model: string;
}
