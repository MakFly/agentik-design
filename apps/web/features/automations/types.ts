import type { AgentId, ISODate, RunId } from "@/types/domain";

/** Open string unions — the engine may add kinds/statuses without breaking the UI. */
export type SignalKind = "webhook" | "schedule" | "event" | "manual" | (string & {});
export type SignalStatus = "active" | "disabled" | (string & {});
export type RuleStatus = "active" | "disabled" | (string & {});
export type GroupPolicy = "open" | "allowlist" | "off";

export interface Signal {
  id: string;
  name: string;
  kind: SignalKind;
  source?: string | null;
  status: SignalStatus;
  config?: Record<string, unknown> | null;
  createdAt?: ISODate;
  updatedAt?: ISODate;
}

export type RuleActionType = "orchestrate" | "run_agent";

export interface RuleAction {
  type: RuleActionType;
  input: string;
}

/** Minimal condition: a list of equality checks serialized to `{ all: [...] }`. */
export interface RuleCondition {
  all?: Array<{ path: string; equals: string }>;
}

export interface Rule {
  id: string;
  name: string;
  status: RuleStatus;
  signalId?: string | null;
  signalName?: string | null;
  condition?: RuleCondition | null;
  action: RuleAction;
  targetAgentId?: AgentId | null;
  agentName?: string | null;
  createdAt?: ISODate;
  updatedAt?: ISODate;
}

export type DeliveryStatus = "succeeded" | "failed" | "running" | "queued" | (string & {});

export interface Delivery {
  id: string;
  signalId: string;
  signalName?: string | null;
  ruleId: string;
  ruleName?: string | null;
  targetAgentId?: AgentId | null;
  agentName?: string | null;
  status: DeliveryStatus;
  runId?: RunId | null;
  error?: string | null;
  createdAt: ISODate;
}

export interface Binding {
  id: string;
  connectionId: string;
  agentId: AgentId | null;
  agentName?: string | null;
  groupPolicy: GroupPolicy;
  requireMention: boolean;
  config?: Record<string, unknown> | null;
  status?: string;
  createdAt?: ISODate;
  updatedAt?: ISODate;
}
