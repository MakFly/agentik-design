export type CompanySize = "solo" | "tpe" | "pme";

export type ScenarioId =
  | "artisan"
  | "restaurant"
  | "clinic"
  | "real-estate"
  | "retail"
  | "services";

export interface HermesScenario {
  id: ScenarioId;
  label: string;
  shortLabel: string;
  category: string;
  pain: string;
  promise: string;
  trigger: string;
  defaultRequest: string;
  tools: string[];
  automations: string[];
  approvalPolicy: string;
  memoryPolicy: string;
  notify: string[];
}

export interface HermesRunRequest {
  companyName: string;
  companySize: CompanySize;
  scenarioId: ScenarioId;
  request: string;
  tone: "direct" | "warm" | "premium";
  isolation: "sandbox" | "approval-first" | "auto-low-risk";
}

export type HermesChatRole = "user" | "assistant";

export interface HermesChatMessage {
  id: string;
  role: HermesChatRole;
  content: string;
}

export type HermesActionKind = "draft_reply" | "create_task" | "request_approval" | "send_notification";

export interface HermesAgentAction {
  id: string;
  kind: HermesActionKind;
  label: string;
  description: string;
  requiresApproval: boolean;
  payload: Record<string, string>;
}

export interface HermesChatRequest {
  context: HermesRunRequest;
  messages: HermesChatMessage[];
}

export interface HermesChatResponse {
  source: "openai" | "fallback";
  message: string;
  actions: HermesAgentAction[];
  memoryWrite: string;
  nextQuestion: string;
}

export interface HermesRunStep {
  title: string;
  owner: "agent" | "operator" | "tool";
  status: "ready" | "approval" | "blocked";
  detail: string;
  tool?: string;
}

export interface HermesRunResult {
  source: "openai" | "fallback";
  title: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  confidence: number;
  estimatedTimeSaved: string;
  nextBestAction: string;
  approvalRequired: boolean;
  steps: HermesRunStep[];
  notifications: string[];
  customerMessage: string;
  memoryWrite: string;
  guardrails: string[];
}

export interface NotificationConfig {
  discord: {
    enabled: boolean;
    webhookUrl: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
}

export interface NotificationResult {
  channel: "discord" | "telegram";
  ok: boolean;
  status?: number;
  message: string;
}
