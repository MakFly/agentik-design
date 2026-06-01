import type {
  Run,
  Step,
  RunId,
  StepId,
  TeamId,
  AgentId,
  ToolId,
  VersionId,
  Cost,
} from "@/types/domain";

const team = "team_acme" as TeamId;
const cost = (cents: number, input: number, output: number): Cost => ({
  tokens: { input, output, total: input + output },
  money: { amountCents: cents, currency: "USD" },
});

export const runs: Run[] = [
  {
    id: "run_8f2" as RunId,
    teamId: team,
    env: "prod",
    subject: { kind: "workflow", workflowId: "wf_77" as never, versionId: "wf_77_v4" as VersionId },
    subjectName: "Support Triage Flow",
    status: "running",
    trigger: { kind: "webhook" },
    startedAt: "2026-05-31T14:22:01Z",
    endedAt: null,
    durationMs: null,
    cost: cost(12, 8200, 1100),
    costCap: { amountCents: 20, currency: "USD" },
    traceId: "9b2c1a",
    stepCount: 7,
    completedSteps: 3,
  },
  {
    id: "run_8d2" as RunId,
    teamId: team,
    env: "prod",
    subject: { kind: "workflow", workflowId: "wf_77" as never, versionId: "wf_77_v4" as VersionId },
    subjectName: "Support Triage Flow",
    status: "succeeded",
    trigger: { kind: "webhook" },
    startedAt: "2026-05-31T13:50:00Z",
    endedAt: "2026-05-31T13:51:09Z",
    durationMs: 69_000,
    cost: cost(21, 14000, 3200),
    costCap: { amountCents: 50, currency: "USD" },
    traceId: "9a8f00",
    stepCount: 6,
    completedSteps: 6,
  },
  {
    id: "run_8d9" as RunId,
    teamId: team,
    env: "prod",
    subject: { kind: "agent", agentId: "agt_scraper" as AgentId, versionId: "agt_scraper_v4" as VersionId },
    subjectName: "Scraper",
    status: "failed",
    trigger: { kind: "schedule" },
    startedAt: "2026-05-31T14:19:44Z",
    endedAt: "2026-05-31T14:19:48Z",
    durationMs: 4_100,
    cost: cost(2, 2100, 400),
    traceId: "9b1d00",
    error: { kind: "tool_error", message: "search_kb returned 500", failedStepId: "step_3b" as StepId, traceId: "9b1d00" },
    stepCount: 4,
    completedSteps: 3,
  },
];

const A = (agentId: string, name: string) => ({ kind: "agent" as const, agentId: agentId as AgentId, name });
const T = (toolId: string, name: string) => ({ kind: "tool" as const, toolId: toolId as ToolId, name });

export const stepsByRun: Record<string, Step[]> = {
  run_8f2: [
    {
      id: "step_0" as StepId, runId: "run_8f2" as RunId, index: 0, nodeId: "trigger",
      actor: { kind: "decision", name: "Trigger" }, status: "succeeded",
      summary: "Webhook received", toolCalls: [], startedAt: "2026-05-31T14:22:01Z",
      endedAt: "2026-05-31T14:22:01Z", durationMs: 40, cost: cost(0, 0, 0), attempt: 1,
    },
    {
      id: "step_1" as StepId, runId: "run_8f2" as RunId, index: 1, nodeId: "triage",
      actor: A("agt_triage", "Triage Agent"), status: "succeeded",
      summary: "Classified as billing",
      reasoning: "The ticket mentions a duplicate charge, which is a billing concern. I'll route it to billing and flag for refund review.",
      toolCalls: [], startedAt: "2026-05-31T14:22:02Z", endedAt: "2026-05-31T14:22:04Z",
      durationMs: 2100, cost: cost(3, 2100, 400), attempt: 1,
    },
    {
      id: "step_2" as StepId, runId: "run_8f2" as RunId, index: 2, nodeId: "decision",
      actor: { kind: "decision", name: "Decision" }, status: "succeeded",
      summary: "Branch → billing", toolCalls: [], startedAt: "2026-05-31T14:22:04Z",
      endedAt: "2026-05-31T14:22:04Z", durationMs: 12, cost: cost(0, 0, 0), attempt: 1,
    },
    {
      id: "step_3" as StepId, runId: "run_8f2" as RunId, index: 3, nodeId: "resolve",
      actor: A("agt_resolve", "Resolve Agent"), status: "running",
      summary: "Searching knowledge base",
      reasoning: "Before deciding on a refund I should look up the customer's recent transactions and the refund policy window.",
      toolCalls: [
        {
          id: "tc_9", toolId: "tl_kb" as ToolId, action: "search_kb",
          request: { query: "duplicate charge refund policy" },
          status: "running",
        },
        {
          id: "tc_8", toolId: "tl_crm" as ToolId, action: "get_customer",
          request: { id: "cus_4831" },
          response: { id: "cus_4831", plan: "pro", since: "2024-02-01" },
          status: "succeeded", httpStatus: 200, latencyMs: 400, cost: cost(0, 0, 0),
        },
      ],
      startedAt: "2026-05-31T14:22:05Z", endedAt: null, durationMs: null, cost: cost(9, 6100, 700), attempt: 1,
    },
    {
      id: "step_4" as StepId, runId: "run_8f2" as RunId, index: 4, nodeId: "approval",
      actor: { kind: "approval", name: "Refund gate" }, status: "pending",
      summary: "Awaiting approval", toolCalls: [], startedAt: "2026-05-31T14:22:05Z",
      endedAt: null, durationMs: null, cost: cost(0, 0, 0), attempt: 1,
      approval: {
        status: "pending", approverRole: "operator", message: "Approve refund of $520 to cus_4831?",
        context: { refundAmount: "$520.00", customer: "cus_4831", reason: "duplicate charge" },
      },
    },
  ],
  run_8d9: [
    {
      id: "step_1b" as StepId, runId: "run_8d9" as RunId, index: 0,
      actor: A("agt_scraper", "Scraper"), status: "succeeded", summary: "Fetched page list",
      reasoning: "Collecting target URLs from the sitemap before extraction.",
      toolCalls: [], startedAt: "2026-05-31T14:19:44Z", endedAt: "2026-05-31T14:19:45Z",
      durationMs: 1100, cost: cost(1, 800, 100), attempt: 1,
    },
    {
      id: "step_2b" as StepId, runId: "run_8d9" as RunId, index: 1,
      actor: A("agt_scraper", "Scraper"), status: "succeeded", summary: "Parsed 12 pages",
      toolCalls: [], startedAt: "2026-05-31T14:19:45Z", endedAt: "2026-05-31T14:19:47Z",
      durationMs: 2000, cost: cost(1, 1300, 300), attempt: 1,
    },
    {
      id: "step_3b" as StepId, runId: "run_8d9" as RunId, index: 2,
      actor: T("tl_kb", "search_kb"), status: "failed", summary: "Tool call failed",
      toolCalls: [
        {
          id: "tc_err", toolId: "tl_kb" as ToolId, action: "search_kb",
          request: { query: "indexed content" },
          status: "failed", httpStatus: 500, latencyMs: 980,
          error: { code: "upstream_500", message: "Knowledge base returned 500 Internal Server Error" },
        },
      ],
      startedAt: "2026-05-31T14:19:47Z", endedAt: "2026-05-31T14:19:48Z", durationMs: 980, cost: cost(0, 0, 0),
      attempt: 1,
      error: { kind: "tool_error", code: "upstream_500", message: "search_kb returned 500", retryable: true },
    },
  ],
  run_8d2: [
    {
      id: "step_d0" as StepId, runId: "run_8d2" as RunId, index: 0,
      actor: A("agt_triage", "Triage Agent"), status: "succeeded", summary: "Classified as general",
      reasoning: "General inquiry; routing to the resolve agent for a direct answer.",
      toolCalls: [], startedAt: "2026-05-31T13:50:00Z", endedAt: "2026-05-31T13:50:02Z",
      durationMs: 2100, cost: cost(3, 2100, 400), attempt: 1,
    },
    {
      id: "step_d1" as StepId, runId: "run_8d2" as RunId, index: 1,
      actor: A("agt_resolve", "Resolve Agent"), status: "succeeded", summary: "Answered & closed",
      toolCalls: [
        {
          id: "tc_d", toolId: "tl_kb" as ToolId, action: "search_kb",
          request: { query: "business hours" },
          response: { hits: 3, top: "support-hours.md" },
          status: "succeeded", httpStatus: 200, latencyMs: 1800, cost: cost(0, 0, 0),
        },
      ],
      startedAt: "2026-05-31T13:50:02Z", endedAt: "2026-05-31T13:51:09Z", durationMs: 67_000,
      cost: cost(18, 11900, 2800), attempt: 1,
    },
  ],
};
