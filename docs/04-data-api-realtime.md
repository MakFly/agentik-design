# 04 · Data Models · API Contracts · Realtime Events

All TypeScript is `strict`-mode-clean and meant to be the actual `types/domain.ts`, `types/api.ts`, `types/events.ts`. IDs are branded for safety.

---

## 8. TypeScript data models

### 8.1 Primitives & shared

```ts
// Branded IDs — prevent passing a runId where an agentId is expected
type Brand<T, B> = T & { readonly __brand: B };
export type TeamId    = Brand<string, "Team">;
export type AgentId   = Brand<string, "Agent">;
export type VersionId = Brand<string, "Version">;
export type WorkflowId= Brand<string, "Workflow">;
export type RunId     = Brand<string, "Run">;
export type StepId    = Brand<string, "Step">;
export type ToolId    = Brand<string, "Tool">;
export type StoreId   = Brand<string, "MemoryStore">;
export type UserId    = Brand<string, "User">;

export type ISODate = string;            // ISO-8601
export type Cents = number;              // money in cents to avoid float drift
export interface Money { amountCents: Cents; currency: "USD" }
export interface TokenUsage { input: number; output: number; cached?: number; total: number }
export interface Cost { tokens: TokenUsage; money: Money }

export type Env = "dev" | "staging" | "prod";
export interface Audited { createdAt: ISODate; updatedAt: ISODate; createdBy: UserId }
export interface Paginated<T> { items: T[]; nextCursor: string | null; total?: number }

export type RunStatus =
  | "queued" | "running" | "paused" | "waiting_approval"
  | "succeeded" | "failed" | "cancelled" | "timed_out";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "retrying";
export type AgentHealth = "healthy" | "degraded" | "error" | "idle" | "disabled";
export type ToolStatus = "connected" | "degraded" | "disconnected" | "auth_expired" | "testing";
```

### 8.2 Agent

```ts
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
  liveVersionId: VersionId | null;          // null while draft-only
  draftVersionId: VersionId | null;
  stats: AgentStats;                         // rolled-up, read-only
}

export interface AgentStats {
  lastRunAt: ISODate | null;
  successRate: number;                       // 0..1 over trailing window
  avgLatencyMs: number;
  avgCost: Money;
  runs24h: number;
}

export interface AgentVersion extends Audited {
  id: VersionId;
  agentId: AgentId;
  version: number;                           // monotonic
  status: "draft" | "published" | "archived";
  changelog?: string;
  config: AgentConfig;                       // the immutable snapshot
}

export interface AgentConfig {
  model: ModelConfig;
  systemPrompt: string;
  promptVariables: PromptVariable[];
  tools: ToolGrant[];
  memory: MemoryBinding[];
  limits: AgentLimits;
  retry: RetryPolicy;
  guardrails: Guardrails;
}

export interface ModelConfig {
  provider: string;                          // "anthropic" | "openai" | "self-hosted"
  model: string;                             // "claude-opus-4-8"
  temperature: number;
  maxTokens: number;
  topP?: number;
  stopSequences?: string[];
  reasoningEffort?: "low" | "medium" | "high";
  jsonMode?: boolean;
  outputSchema?: JsonSchema;                 // when structured output required
}

export interface PromptVariable { key: string; source: "input" | "memory" | "context"; required: boolean }

export interface ToolGrant {
  toolId: ToolId;
  scopes: string[];                          // subset of the tool's available scopes
  rateCapPerMin?: number;
  requireApproval?: boolean;                 // human gate before this tool acts
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
  maxCostPerRun: Money;                       // hard stop
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
  blockedActions: string[];                  // tool actions explicitly forbidden
  requireApprovalFor: string[];              // sensitive actions needing a human
  egressAllowlist: string[];                 // domains the agent may reach
  contentFilters: Array<"toxicity" | "secrets" | "prompt_injection">;
}
```

### 8.3 Workflow

```ts
export interface Workflow extends Audited {
  id: WorkflowId; teamId: TeamId; name: string; description?: string; tags: string[];
  liveVersionId: VersionId | null; draftVersionId: VersionId | null;
  stats: { lastRunAt: ISODate | null; successRate: number; runs24h: number };
}

export interface WorkflowVersion extends Audited {
  id: VersionId; workflowId: WorkflowId; version: number;
  status: "draft" | "published" | "archived"; changelog?: string;
  graph: WorkflowGraph;
}

export interface WorkflowGraph { nodes: WorkflowNode[]; edges: WorkflowEdge[] }

export type NodeType =
  | "trigger" | "agent" | "tool" | "api" | "decision"
  | "approval" | "code" | "loop" | "subflow" | "end";

export interface WorkflowNode {
  id: string; type: NodeType;
  position: { x: number; y: number };
  label: string;
  config: NodeConfig;                        // discriminated by type (below)
}

export type NodeConfig =
  | { type: "trigger"; trigger: "manual" | "webhook" | "schedule" | "event"; schema?: JsonSchema; cron?: string }
  | { type: "agent"; agentId: AgentId; versionId: VersionId | "live"; inputMap: IOMap; onError: NodeErrorPolicy; timeoutMs: number }
  | { type: "tool"; toolId: ToolId; action: string; argsMap: IOMap; scopes: string[] }
  | { type: "api"; method: HttpMethod; url: string; headers?: Record<string,string>; bodyMap?: IOMap; auth?: string; timeoutMs: number }
  | { type: "decision"; branches: Array<{ label: string; expression: string }>; default: string }
  | { type: "approval"; approverRole: string; message: string; timeoutMs: number; onTimeout: "approve" | "reject" }
  | { type: "code"; language: "js"; source: string }
  | { type: "loop"; collection: string; concurrency: number; maxIterations: number }
  | { type: "subflow"; workflowId: WorkflowId; versionId: VersionId | "live"; inputMap: IOMap }
  | { type: "end"; outputSchema?: JsonSchema };

export interface WorkflowEdge { id: string; source: string; sourceHandle?: string; target: string; targetHandle?: string; label?: string }
export type IOMap = Record<string, string>; // target field ← source expression ("trigger.ticket")
export type NodeErrorPolicy = { onError: "fail" | "retry" | "continue" | "route"; retry?: RetryPolicy; routeTo?: string };
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
```

### 8.4 Run / Step / ToolCall

```ts
export interface Run {
  id: RunId; teamId: TeamId; env: Env;
  subject: { kind: "agent"; agentId: AgentId; versionId: VersionId }
         | { kind: "workflow"; workflowId: WorkflowId; versionId: VersionId };
  status: RunStatus;
  trigger: { kind: "manual" | "webhook" | "schedule" | "api"; by?: UserId; payloadRef?: string };
  startedAt: ISODate; endedAt: ISODate | null; durationMs: number | null;
  cost: Cost; costCap?: Money;
  traceId: string;
  error?: RunError;
  stepCount: number; completedSteps: number;
}

export interface Step {
  id: StepId; runId: RunId; index: number;
  nodeId?: string;                           // present for workflow runs
  actor: { kind: "agent"; agentId: AgentId; name: string }
       | { kind: "tool"; toolId: ToolId; name: string }
       | { kind: "decision" | "approval" | "api" | "code" | "loop"; name: string };
  status: StepStatus;
  summary: string;                           // one-line, for the timeline
  reasoning?: string;                        // model reasoning (streamed)
  toolCalls: ToolCall[];
  logsRef?: string;                          // cursor into the log stream
  startedAt: ISODate; endedAt: ISODate | null; durationMs: number | null;
  cost: Cost;
  attempt: number;                           // for retries
  error?: StepError;
  approval?: ApprovalState;                   // when actor is approval
}

export interface ToolCall {
  id: string; toolId: ToolId; action: string;
  request: unknown; response?: unknown;
  status: "running" | "succeeded" | "failed";
  httpStatus?: number; latencyMs?: number; cost?: Cost;
  error?: { code: string; message: string };
}

export interface ApprovalState {
  status: "pending" | "approved" | "rejected" | "timed_out";
  approverRole: string; message: string;
  context: Record<string, unknown>;          // e.g. { refundAmount, customer }
  decidedBy?: UserId; decidedAt?: ISODate; reason?: string;
}

export interface RunError { kind: AppErrorKind; message: string; failedStepId?: StepId; traceId: string }
export interface StepError { kind: AppErrorKind; code: string; message: string; retryable: boolean }
export type AppErrorKind = "network"|"auth"|"forbidden"|"not_found"|"validation"|"rate_limit"|"provider"|"conflict"|"server"|"tool_error"|"timeout"|"budget_exceeded"|"unknown";
```

### 8.5 Tool · Memory · Eval (essence)

```ts
export interface Tool extends Audited {
  id: ToolId; teamId: TeamId; definitionId: string;   // "github" | "stripe" | "rest" …
  name: string; env: Env; status: ToolStatus;
  authKind: "api_key" | "oauth" | "connection_string" | "webhook" | "none";
  grantedScopes: string[]; availableScopes: ToolScope[];
  rateCapPerMin?: number;
  usedBy: { agents: AgentId[]; workflows: WorkflowId[] };
  lastTest?: ToolTestResult;
}
export interface ToolScope { id: string; label: string; risk: "read" | "write" | "admin" }
export interface ToolTestResult { at: ISODate; ok: boolean; checks: Array<{ name: string; ok: boolean; latencyMs?: number; error?: string; remedy?: string }> }

export interface MemoryStore extends Audited {
  id: StoreId; teamId: TeamId; name: string;
  embeddingModel: string; dimensions: number;
  chunking: { size: number; overlap: number };
  policy: { ttlDays: number | null; redactPII: boolean };
  stats: { documents: number; chunks: number; lastIndexedAt: ISODate | null };
  access: { readAgents: AgentId[]; writeAgents: AgentId[] };
}
export interface MemoryDocument { id: string; storeId: StoreId; name: string; source: "upload"|"crawl"|"connector"|"api"; status: "queued"|"extracting"|"chunking"|"embedding"|"indexed"|"failed"; chunks: number; updatedAt: ISODate }
export interface RetrievedChunk { id: string; documentId: string; documentName: string; score: number; text: string; citation: string }

export interface EvalSuite extends Audited { id: string; teamId: TeamId; name: string; datasets: Dataset[]; scorers: Scorer[] }
export interface Dataset { id: string; name: string; size: number }
export interface Scorer { id: string; name: string; kind: "exact" | "regex" | "llm_judge" | "human" | "code" }
export interface EvalRun { id: string; suiteId: string; targets: Array<{ agentId: AgentId; versionId: VersionId; model?: string }>; status: RunStatus; results: EvalResult[] }
export interface EvalResult { target: VersionId; score: number; passed: number; total: number; avgLatencyMs: number; avgCost: Money; perScorer: Record<string, number>; regressions: Array<{ caseId: string; before: number; after: number }> }
```

---

## 9. API contract examples

REST, JSON, cursor pagination, team scoping via `x-team` header (or `/{team}` in BFF). Errors follow the normalized shape (doc 03 §7.6).

### 9.1 List runs (filtered, paginated)

```http
GET /v1/runs?status=failed&env=prod&agentId=agt_123&cursor=eyJ...&limit=25
x-team: team_acme
```
```jsonc
// 200
{
  "items": [
    { "id": "run_8d9", "status": "failed", "env": "prod",
      "subject": { "kind": "agent", "agentId": "agt_123", "versionId": "ver_4" },
      "startedAt": "2026-05-31T14:19:44Z", "durationMs": 4100,
      "cost": { "tokens": { "input": 2100, "output": 400, "total": 2500 },
                "money": { "amountCents": 2, "currency": "USD" } },
      "error": { "kind": "tool_error", "message": "search_kb returned 500", "failedStepId": "step_3", "traceId": "9b1.." },
      "stepCount": 6, "completedSteps": 3, "traceId": "9b1.." }
  ],
  "nextCursor": "eyJvIjoyNX0",
  "total": 7
}
```

### 9.2 Create + publish an agent version

```http
POST /v1/agents
x-team: team_acme
Idempotency-Key: 7d2c…
{ "name": "Support Triage Agent", "role": "Tier-1 triage", "goal": "Classify & route tickets", "tags": ["support"] }
→ 201 { "id": "agt_123", "draftVersionId": "ver_draft_1", ... }

PUT /v1/agents/agt_123/versions/ver_draft_1
{ "config": { "model": { "provider":"anthropic","model":"claude-opus-4-8","temperature":0.2,"maxTokens":2048 },
              "systemPrompt": "You are a support triage agent…",
              "tools": [{ "toolId":"tl_gh","scopes":["repo:read"] }],
              "limits": { "maxCostPerRun": { "amountCents": 20, "currency":"USD" }, ... }, ... } }
→ 200 { "valid": true, "warnings": [{ "field":"tools[0]","message":"write scope without approval gate" }] }

POST /v1/agents/agt_123/versions/ver_draft_1/publish
{ "changelog": "Add refund routing" }
→ 201 { "versionId": "ver_4", "version": 4, "status": "published" }
```

### 9.3 Start a run

```http
POST /v1/runs
x-team: team_acme
Idempotency-Key: 9af…
{ "subject": { "kind": "workflow", "workflowId": "wf_77", "versionId": "live" },
  "env": "prod", "input": { "ticket": "I was double charged" } }
→ 202 { "id": "run_8f2", "status": "queued", "traceId": "9b2..", "streamUrl": "/v1/runs/run_8f2/stream" }
```

### 9.4 Control a run

```http
POST /v1/runs/run_8f2/control   { "action": "pause" }                 → 202 { "accepted": true }
POST /v1/runs/run_8f2/control   { "action": "cancel" }                → 202
POST /v1/runs/run_8f2/steps/step_5/retry  { "from": "step" }          → 202 { "newAttempt": 2 }
POST /v1/runs/run_8f2/approvals/step_4    { "decision": "approve", "reason": "verified" }  → 200
```

### 9.5 Memory retrieval (debug)

```http
POST /v1/memory/ks_1/search   { "query": "refund window", "topK": 5 }
→ 200 { "results": [ { "documentName":"refund-policy.pdf","score":0.91,"text":"…30 days…","citation":"refund-policy.pdf · p.3" }, … ] }
```

### 9.6 Tool test

```http
POST /v1/tools/tl_stripe/test
→ 200 { "ok": false, "checks": [
  { "name":"auth","ok":true,"latencyMs":120 },
  { "name":"read charges","ok":true,"latencyMs":240 },
  { "name":"create refund","ok":false,"error":"401 missing scope","remedy":"grant refunds:write in Stripe" } ] }
```

---

## 10. Realtime event schema

Transport: **SSE** for streams (`GET /v1/runs/{id}/stream`), **WSS** for control. Every event has a monotonic `id` (for `Last-Event-ID` replay), a `seq` per run, and an ISO `ts`.

### 10.1 Envelope & discriminated union

```ts
export interface EventEnvelope<T extends RunEvent = RunEvent> {
  id: string;                  // global, for Last-Event-ID
  seq: number;                 // per-run ordering
  ts: ISODate;
  runId: RunId;
  event: T["type"];            // SSE "event:" field
  data: T;                     // SSE "data:" field (JSON)
}

export type RunEvent =
  | RunStatusChanged | RunCostUpdated
  | StepStarted | StepCompleted | StepFailed | StepRetrying
  | ReasoningDelta
  | ToolCallStarted | ToolCallCompleted
  | ApprovalRequested | ApprovalResolved
  | LogLine
  | StreamError;

export interface RunStatusChanged { type: "run.status.changed"; status: RunStatus; reason?: string }
export interface RunCostUpdated   { type: "run.cost.updated"; cost: Cost; capRemaining?: Money }

export interface StepStarted   { type: "step.started"; step: Pick<Step,"id"|"index"|"actor"|"summary"|"nodeId"> }
export interface StepCompleted { type: "step.completed"; stepId: StepId; status: "succeeded"|"skipped"; durationMs: number; cost: Cost; summary: string }
export interface StepFailed    { type: "step.failed"; stepId: StepId; error: StepError }
export interface StepRetrying  { type: "step.retrying"; stepId: StepId; attempt: number; delayMs: number }

export interface ReasoningDelta { type: "reasoning.delta"; stepId: StepId; textDelta: string }     // high-frequency → Zustand buffer

export interface ToolCallStarted   { type: "tool_call.started"; stepId: StepId; call: Pick<ToolCall,"id"|"toolId"|"action"|"request"> }
export interface ToolCallCompleted { type: "tool_call.completed"; stepId: StepId; callId: string; status: "succeeded"|"failed"; response?: unknown; httpStatus?: number; latencyMs: number; cost?: Cost; error?: ToolCall["error"] }

export interface ApprovalRequested { type: "approval.requested"; stepId: StepId; approval: ApprovalState }
export interface ApprovalResolved  { type: "approval.resolved"; stepId: StepId; decision: "approved"|"rejected"|"timed_out"; by?: UserId }

export interface LogLine    { type: "log.line"; stepId?: StepId; level: "debug"|"info"|"warn"|"error"; message: string }
export interface StreamError{ type: "stream.error"; kind: AppErrorKind; message: string; fatal: boolean }
```

### 10.2 Wire example (SSE)

```
id: 401
event: step.started
data: {"runId":"run_8f2","seq":12,"ts":"2026-05-31T14:22:39Z","step":{"id":"step_4","index":4,"actor":{"kind":"agent","agentId":"agt_123","name":"Triage Agent"},"summary":"Searching knowledge base"}}

id: 402
event: reasoning.delta
data: {"runId":"run_8f2","seq":13,"ts":"...","stepId":"step_4","textDelta":"The ticket mentions a duplicate charge"}

id: 415
event: tool_call.completed
data: {"runId":"run_8f2","seq":21,"ts":"...","stepId":"step_4","callId":"tc_9","status":"succeeded","httpStatus":200,"latencyMs":1800,"cost":{"tokens":{"input":0,"output":0,"total":0},"money":{"amountCents":0,"currency":"USD"}}}

id: 419
event: run.cost.updated
data: {"runId":"run_8f2","seq":25,"ts":"...","cost":{"tokens":{"input":8200,"output":1100,"total":9300},"money":{"amountCents":12,"currency":"USD"}},"capRemaining":{"amountCents":8,"currency":"USD"}}
```

### 10.3 Control channel (WS, client→server)

```ts
export type ControlMessage =
  | { type: "run.subscribe"; runId: RunId; lastEventId?: string }
  | { type: "run.unsubscribe"; runId: RunId }
  | { type: "run.pause"; runId: RunId }
  | { type: "run.resume"; runId: RunId }
  | { type: "run.cancel"; runId: RunId }
  | { type: "run.approve"; runId: RunId; stepId: StepId; decision: "approve"|"reject"; reason?: string };

// server → client ack
export interface ControlAck { type: "control.ack"; runId: RunId; action: string; accepted: boolean; error?: string }
```

### 10.4 Client reducer (how events mutate state)

```
event                    →  target store            →  effect
─────────────────────────────────────────────────────────────────────────────────────
step.started             →  runStream.store          →  push step (status running), auto-select if live
reasoning.delta          →  runStream.store          →  append to reasoningByStep[stepId] (rAF-flushed)
tool_call.started/…      →  runStream.store          →  upsert toolCalls on step
step.completed/failed    →  runStream.store + Query  →  patch step; on failed → select + surface error
run.cost.updated         →  runStream.store          →  update CostMeter (capRemaining → warn at <10%)
run.status.changed       →  runStream.store + Query  →  update header + dashboard live list
approval.requested       →  runStream + approvals    →  show ApprovalCard + global tray badge (pulse)
log.line                 →  runStream.store          →  append to LogStream (virtualized, capped)
stream.error fatal       →  connection state         →  show reconnect chip; backoff; replay from lastEventId
```

On run completion (`run.status.changed` → terminal), the client does **one** authoritative `GET /v1/runs/{id}` to reconcile, then drops the stream buffer.
