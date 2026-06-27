/**
 * Agentik domain models (docs/04 §8). Branded IDs prevent passing a runId where
 * an agentId is expected. These are the canonical shapes the UI renders.
 */

import type { RuntimeKind } from "@agentik/workflow-schema";
export type { RuntimeKind };

type Brand<T, B> = T & { readonly __brand: B };
export type TeamId = Brand<string, "Team">;
export type AgentId = Brand<string, "Agent">;
export type VersionId = Brand<string, "Version">;
export type WorkflowId = Brand<string, "Workflow">;
export type RunId = Brand<string, "Run">;
export type StepId = Brand<string, "Step">;
export type ToolId = Brand<string, "Tool">;
export type StoreId = Brand<string, "MemoryStore">;
export type UserId = Brand<string, "User">;

export type ISODate = string;
export type Cents = number;
export type JsonSchema = Record<string, unknown>;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type IOMap = Record<string, string>;
export type Env = "dev" | "staging" | "prod";
export type EnvironmentColor =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "muted";

export interface ManagedEnvironment {
  id: string;
  label: string;
  color: EnvironmentColor;
}

export interface EnvironmentSettings {
  items: ManagedEnvironment[];
  activeId: string;
  source: "settings" | "node_env";
  nodeEnv: string;
}

export interface Money {
  amountCents: Cents;
  currency: "USD";
}
export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
  total: number;
}
export interface Cost {
  tokens: TokenUsage;
  money: Money;
}

export interface Audited {
  createdAt: ISODate;
  updatedAt: ISODate;
  createdBy: UserId;
}
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";
export type StepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "retrying";
export type AgentHealth =
  | "healthy"
  | "degraded"
  | "error"
  | "idle"
  | "disabled";
export type ToolStatus =
  | "connected"
  | "degraded"
  | "disconnected"
  | "auth_expired"
  | "testing";
export type McpTransport = "streamable_http" | "sse";
export type McpServerStatus = "unknown" | "online" | "error";
export type McpToolStatus = "available" | "unavailable";

export type AppErrorKind =
  | "network"
  | "auth"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limit"
  | "provider"
  | "conflict"
  | "server"
  | "tool_error"
  | "timeout"
  | "budget_exceeded"
  | "unknown";

/* ───────────────────────────── Agent ───────────────────────────── */

export interface AgentStats {
  lastRunAt: ISODate | null;
  successRate: number;
  avgLatencyMs: number;
  avgCost: Money;
  runs24h: number;
}

export interface Agent extends Audited {
  id: AgentId;
  teamId: TeamId;
  name: string;
  role: string;
  goal: string;
  description?: string;
  tags: string[];
  owner: UserId;
  health: AgentHealth;
  runtimeKind?: RuntimeKind;
  preferredDaemonId?: string | null;
  liveVersionId: VersionId | null;
  draftVersionId: VersionId | null;
  stats: AgentStats;
}

export interface ModelConfig {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  stopSequences?: string[];
  reasoningEffort?: "low" | "medium" | "high";
  jsonMode?: boolean;
  outputSchema?: JsonSchema;
}

export interface PromptVariable {
  key: string;
  source: "input" | "memory" | "context";
  required: boolean;
}

export interface ToolGrant {
  toolId: ToolId;
  scopes: string[];
  rateCapPerMin?: number;
  requireApproval?: boolean;
}

export interface ToolCatalogItem {
  toolId: ToolId;
  name: string;
  label: string;
  description: string;
  source: "built-in" | "http" | "mcp";
  serverId?: string;
  serverName?: string;
  inputSchema?: JsonSchema;
  scopes: string[];
  status: "available" | "unavailable";
}

export interface McpTool {
  id: string;
  teamId: TeamId;
  serverId: string;
  toolId: ToolId;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  status: McpToolStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface McpServer {
  id: string;
  teamId: TeamId;
  name: string;
  transport: McpTransport;
  url: string;
  credentialId: string | null;
  status: McpServerStatus;
  lastError: string | null;
  lastSyncAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  toolCount?: number;
  tools?: McpTool[];
}

export interface MemoryBinding {
  storeId: StoreId;
  mode: "read" | "read_write";
  topK: number;
  recencyWindowDays?: number;
  cite: boolean;
}

export interface AgentLimits {
  requestsPerMin: number;
  maxConcurrentRuns: number;
  maxTokensPerRun: number;
  maxCostPerRun: Money;
  timeoutMs: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: "fixed" | "exponential";
  initialDelayMs: number;
  retryOn: Array<"timeout" | "rate_limit" | "provider_error" | "tool_error">;
}

export interface Guardrails {
  redactPII: boolean;
  blockedActions: string[];
  requireApprovalFor: string[];
  egressAllowlist: string[];
  contentFilters: Array<"toxicity" | "secrets" | "prompt_injection">;
}

export interface RuntimeBinding {
  /** Machine pin for this agent. Null means any connected daemon with the runtime may claim it. */
  daemonId: string | null;
}

export interface AgentConfig {
  /** Which daemon runtime executes this agent (echo/claude/hermes/…). Defaults to echo. */
  runtimeKind?: RuntimeKind;
  runtimeBinding?: RuntimeBinding;
  model: ModelConfig;
  systemPrompt: string;
  promptVariables: PromptVariable[];
  tools: ToolGrant[];
  memory: MemoryBinding[];
  limits: AgentLimits;
  retry: RetryPolicy;
  guardrails: Guardrails;
}

export interface AgentVersion extends Audited {
  id: VersionId;
  agentId: AgentId;
  version: number;
  status: "draft" | "published" | "archived";
  changelog?: string;
  config: AgentConfig;
}

/* ─────────────────────────── Workflow ─────────────────────────── */

export type NodeType =
  | "trigger"
  | "agent"
  | "tool"
  | "api"
  | "decision"
  | "approval"
  | "code"
  | "loop"
  | "subflow"
  | "end"
  | "set"
  | "filter"
  | "limit"
  | "merge"
  | "noop"
  | "sort"
  | "aggregate"
  | "splitOut"
  | "removeDuplicates"
  | "renameKeys"
  | "crypto"
  | "dateTime"
  | "summarize"
  | "slack";

export type NodeErrorPolicy = {
  onError: "fail" | "retry" | "continue" | "route";
  retry?: RetryPolicy;
  routeTo?: string;
};

export type NodeConfig =
  | {
      type: "trigger";
      trigger: "manual" | "webhook" | "schedule" | "event";
      schema?: JsonSchema;
      cron?: string;
    }
  | {
      type: "agent";
      agentId?: AgentId;
      versionId?: VersionId | "live";
      model?: string;
      instructions?: string;
      prompt?: string;
      inputMap: IOMap;
      onError?: NodeErrorPolicy;
      timeoutMs: number;
    }
  | {
      type: "tool";
      toolId: ToolId;
      action: string;
      argsMap: IOMap;
      scopes: string[];
    }
  | {
      type: "api";
      method: HttpMethod;
      url: string;
      headers?: Record<string, string>;
      bodyMap?: IOMap;
      auth?: string;
      credentialId?: string;
      timeoutMs: number;
    }
  | {
      type: "decision";
      branches: Array<{ label: string; expression: string }>;
      default: string;
    }
  | {
      type: "approval";
      approverRole: string;
      message: string;
      timeoutMs: number;
      onTimeout: "approve" | "reject";
    }
  | { type: "code"; language: "js"; source: string; mode?: "all" | "each" }
  | {
      type: "loop";
      collection: string;
      concurrency: number;
      maxIterations: number;
    }
  | {
      type: "subflow";
      workflowId: WorkflowId;
      versionId: VersionId | "live";
      inputMap: IOMap;
    }
  | { type: "end"; outputSchema?: JsonSchema }
  | {
      type: "set";
      assignments: Array<{ name: string; value: string }>;
      keepOnlySet?: boolean;
    }
  | { type: "filter"; condition: string }
  | { type: "limit"; maxItems: number; keep?: "first" | "last" }
  | { type: "merge"; mode?: "append" }
  | { type: "noop" }
  | { type: "sort"; field: string; order?: "asc" | "desc" }
  | { type: "aggregate"; field?: string }
  | { type: "splitOut"; field: string }
  | { type: "removeDuplicates"; field?: string }
  | { type: "renameKeys"; renames: Array<{ from: string; to: string }> }
  | {
      type: "crypto";
      action?: "hash" | "hmac";
      algorithm?: "sha256" | "sha512" | "md5";
      value: string;
      secret?: string;
      field?: string;
    }
  | {
      type: "dateTime";
      action?: "format" | "add";
      sourceField?: string;
      outputField?: string;
      format?: string;
      amount?: number;
      unit?: "days" | "hours" | "minutes" | "months" | "years";
    }
  | {
      type: "summarize";
      groupBy: string;
      operation?: "count" | "sum";
      field?: string;
    }
  | { type: "slack"; credentialId: string; channel: string; text: string };

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  label: string;
  notes?: string;
  config: NodeConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow extends Audited {
  id: WorkflowId;
  teamId: TeamId;
  name: string;
  description?: string;
  tags: string[];
  liveVersionId: VersionId | null;
  draftVersionId: VersionId | null;
  stats: { lastRunAt: ISODate | null; successRate: number; runs24h: number };
}

export interface WorkflowVersion extends Audited {
  id: VersionId;
  workflowId: WorkflowId;
  version: number;
  status: "draft" | "published" | "archived";
  changelog?: string;
  graph: WorkflowGraph;
}

/* ────────────────────── Run / Step / ToolCall ─────────────────── */

export interface RunError {
  kind: AppErrorKind;
  message: string;
  failedStepId?: StepId;
  traceId: string;
}
export interface StepError {
  kind: AppErrorKind;
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolCall {
  id: string;
  toolId: ToolId;
  action: string;
  request: unknown;
  response?: unknown;
  status: "running" | "succeeded" | "failed";
  httpStatus?: number;
  latencyMs?: number;
  cost?: Cost;
  error?: { code: string; message: string };
}

export interface ApprovalState {
  status: "pending" | "approved" | "rejected" | "timed_out";
  approverRole: string;
  message: string;
  context: Record<string, unknown>;
  decidedBy?: UserId;
  decidedAt?: ISODate;
  reason?: string;
}

export type StepActor =
  | { kind: "agent"; agentId: AgentId; name: string }
  | { kind: "tool"; toolId: ToolId; name: string }
  | { kind: "decision" | "approval" | "api" | "code" | "loop"; name: string };

export interface Step {
  id: StepId;
  runId: RunId;
  index: number;
  nodeId?: string;
  actor: StepActor;
  status: StepStatus;
  summary: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  logsRef?: string;
  startedAt: ISODate;
  endedAt: ISODate | null;
  durationMs: number | null;
  cost: Cost;
  attempt: number;
  error?: StepError;
  approval?: ApprovalState;
}

export type RunSubject =
  | { kind: "agent"; agentId: AgentId; versionId: VersionId }
  | { kind: "workflow"; workflowId: WorkflowId; versionId: VersionId };

export interface Run {
  id: RunId;
  teamId: TeamId;
  env: Env;
  subject: RunSubject;
  status: RunStatus;
  trigger: {
    kind: "manual" | "webhook" | "schedule" | "api";
    by?: UserId;
    payloadRef?: string;
  };
  startedAt: ISODate;
  endedAt: ISODate | null;
  durationMs: number | null;
  cost: Cost;
  costCap?: Money;
  traceId: string;
  error?: RunError;
  stepCount: number;
  completedSteps: number;
  /** denormalized label for lists */
  subjectName?: string;
}

/* ────────────────── Tool · Memory · Eval ──────────────────────── */

export interface ToolScope {
  id: string;
  label: string;
  risk: "read" | "write" | "admin";
}
export interface ToolTestResult {
  at: ISODate;
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    latencyMs?: number;
    error?: string;
    remedy?: string;
  }>;
}
export interface Tool extends Audited {
  id: ToolId;
  teamId: TeamId;
  definitionId: string;
  name: string;
  env: Env;
  status: ToolStatus;
  authKind: "api_key" | "oauth" | "connection_string" | "webhook" | "none";
  grantedScopes: string[];
  availableScopes: ToolScope[];
  rateCapPerMin?: number;
  usedBy: { agents: AgentId[]; workflows: WorkflowId[] };
  lastTest?: ToolTestResult;
}

export interface MemoryStore extends Audited {
  id: StoreId;
  teamId: TeamId;
  name: string;
  embeddingModel: string;
  dimensions: number;
  chunking: { size: number; overlap: number };
  policy: { ttlDays: number | null; redactPII: boolean };
  stats: { documents: number; chunks: number; lastIndexedAt: ISODate | null };
  access: { readAgents: AgentId[]; writeAgents: AgentId[] };
}
export interface MemoryDocument {
  id: string;
  storeId: StoreId;
  name: string;
  source: "upload" | "crawl" | "connector" | "api";
  status:
    | "queued"
    | "extracting"
    | "chunking"
    | "embedding"
    | "indexed"
    | "failed";
  chunks: number;
  updatedAt: ISODate;
}
export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  score: number;
  text: string;
  citation: string;
}

export interface Dataset {
  id: string;
  name: string;
  size: number;
}
export interface Scorer {
  id: string;
  name: string;
  kind: "exact" | "regex" | "llm_judge" | "human" | "code";
}
export interface EvalResult {
  target: VersionId;
  score: number;
  passed: number;
  total: number;
  avgLatencyMs: number;
  avgCost: Money;
  perScorer: Record<string, number>;
  regressions: Array<{ caseId: string; before: number; after: number }>;
}
export interface EvalSuite extends Audited {
  id: string;
  teamId: TeamId;
  name: string;
  datasets: Dataset[];
  scorers: Scorer[];
}
export interface EvalRun {
  id: string;
  suiteId: string;
  targets: Array<{ agentId: AgentId; versionId: VersionId; model?: string }>;
  status: RunStatus;
  results: EvalResult[];
}

/* ───────────────────── Session / People ───────────────────────── */

import type { Role, Permission } from "@/config/permissions";

export interface User {
  id: UserId;
  name: string;
  email: string;
  avatarUrl?: string;
}
export interface TeamRef {
  id: TeamId;
  slug: string;
  name: string;
}
export interface Session {
  user: User;
  team: TeamRef;
  role: Role;
  permissions: Permission[] | "*";
  teams: TeamRef[];
  onboardingCompleted: boolean;
}
