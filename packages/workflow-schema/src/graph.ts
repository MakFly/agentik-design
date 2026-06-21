import { z } from "zod";

/**
 * Workflow graph contract — the single source of truth shared by the canvas
 * editor (apps/web), the REST API and the execution engine. Mirrors the legacy
 * TypeScript types in apps/web/types/domain.ts, promoted here to runtime zod
 * schemas so every layer validates the same shape.
 */

export const NODE_TYPES = [
  "trigger",
  "agent",
  "tool",
  "api",
  "decision",
  "approval",
  "code",
  "loop",
  "subflow",
  "end",
  // n8n "core" data nodes (item manipulation, no credentials needed)
  "set",
  "filter",
  "limit",
  "merge",
  "noop",
  "sort",
  "aggregate",
  "splitOut",
  "removeDuplicates",
  "renameKeys",
  "crypto",
  "dateTime",
  "summarize",
  // credentialed integration (Phase 5)
  "slack",
] as const;

export const nodeType = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof nodeType>;

export const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof httpMethod>;

/** Map from a downstream field name to a JSONPath-ish expression on run data. */
export const ioMap = z.record(z.string(), z.string());
export type IOMap = z.infer<typeof ioMap>;

export const jsonSchema = z.record(z.string(), z.unknown());

export const retryPolicy = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  backoffMs: z.number().int().min(0),
  strategy: z.enum(["fixed", "exponential"]).default("fixed"),
});
export type RetryPolicy = z.infer<typeof retryPolicy>;

export const nodeErrorPolicy = z.object({
  onError: z.enum(["fail", "retry", "continue", "route"]),
  retry: retryPolicy.optional(),
  routeTo: z.string().optional(),
});
export type NodeErrorPolicy = z.infer<typeof nodeErrorPolicy>;

/**
 * Per-type node configuration. Discriminated on `type` so the editor and the
 * engine can narrow exhaustively. Node types not yet executable by the engine
 * are still valid here (the editor can author them); the engine rejects an
 * unimplemented type at run time with a clear error.
 */
export const nodeConfig = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("trigger"),
    trigger: z.enum(["manual", "webhook", "schedule", "event"]),
    schema: jsonSchema.optional(),
    cron: z.string().optional(),
  }),
  z.object({
    type: z.literal("agent"),
    // Optional binding to a registry agent (future). When absent, the node runs
    // self-contained from the inline model/instructions/prompt below.
    agentId: z.string().optional(),
    versionId: z.string().optional(),
    model: z.string().optional(),
    instructions: z.string().optional(),
    prompt: z.string().optional(),
    inputMap: ioMap.default({}),
    onError: nodeErrorPolicy.optional(),
    timeoutMs: z.number().int().positive().default(30_000),
  }),
  z.object({
    type: z.literal("tool"),
    toolId: z.string(),
    action: z.string(),
    argsMap: ioMap.default({}),
    scopes: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal("api"),
    method: httpMethod,
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyMap: ioMap.optional(),
    auth: z.string().optional(),
    /** Optional httpHeaderAuth credential id — adds an auth header at run time. */
    credentialId: z.string().optional(),
    timeoutMs: z.number().int().positive().default(30_000),
  }),
  z.object({
    type: z.literal("decision"),
    branches: z.array(z.object({ label: z.string(), expression: z.string() })),
    default: z.string(),
  }),
  z.object({
    type: z.literal("approval"),
    approverRole: z.string(),
    message: z.string(),
    timeoutMs: z.number().int().positive(),
    onTimeout: z.enum(["approve", "reject"]),
  }),
  z.object({
    type: z.literal("code"),
    language: z.literal("js"),
    source: z.string(),
    // n8n's two code modes: run once over all items, or once per item.
    mode: z.enum(["all", "each"]).default("all"),
  }),
  z.object({
    type: z.literal("loop"),
    collection: z.string(),
    concurrency: z.number().int().min(1).default(1),
    maxIterations: z.number().int().positive().default(1000),
  }),
  z.object({
    type: z.literal("subflow"),
    workflowId: z.string(),
    versionId: z.string(),
    inputMap: ioMap.default({}),
  }),
  z.object({
    type: z.literal("end"),
    outputSchema: jsonSchema.optional(),
  }),
  // ── n8n core nodes ───────────────────────────────────────────────────────
  z.object({
    // Edit Fields (Set) — assign/override fields on each item.
    type: z.literal("set"),
    assignments: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    keepOnlySet: z.boolean().default(false),
  }),
  z.object({
    // Filter — keep only items whose condition expression is truthy.
    type: z.literal("filter"),
    condition: z.string(),
  }),
  z.object({
    // Limit — keep the first/last N items.
    type: z.literal("limit"),
    maxItems: z.number().int().positive().default(1),
    keep: z.enum(["first", "last"]).default("first"),
  }),
  z.object({
    // Merge — combine items from all input ports into one stream.
    type: z.literal("merge"),
    mode: z.enum(["append"]).default("append"),
  }),
  z.object({
    // No Operation — pass items through unchanged.
    type: z.literal("noop"),
  }),
  z.object({
    // Sort — order items by a field.
    type: z.literal("sort"),
    field: z.string(),
    order: z.enum(["asc", "desc"]).default("asc"),
  }),
  z.object({
    // Aggregate — combine all items into one (collect a field, or all json).
    type: z.literal("aggregate"),
    field: z.string().optional(),
  }),
  z.object({
    // Split Out — turn an array field into one item per element.
    type: z.literal("splitOut"),
    field: z.string(),
  }),
  z.object({
    // Remove Duplicates — drop items with a repeated key (a field, or whole json).
    type: z.literal("removeDuplicates"),
    field: z.string().optional(),
  }),
  z.object({
    // Rename Keys — rename fields on each item.
    type: z.literal("renameKeys"),
    renames: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
  }),
  z.object({
    // Crypto — hash/HMAC a value into a field.
    type: z.literal("crypto"),
    action: z.enum(["hash", "hmac"]).default("hash"),
    algorithm: z.enum(["sha256", "sha512", "md5"]).default("sha256"),
    value: z.string(),
    secret: z.string().optional(),
    field: z.string().default("hash"),
  }),
  z.object({
    // Date & Time — format or shift a date into a field (Luxon).
    type: z.literal("dateTime"),
    action: z.enum(["format", "add"]).default("format"),
    sourceField: z.string().optional(), // empty → now
    outputField: z.string().default("date"),
    format: z.string().default("yyyy-MM-dd"),
    amount: z.number().default(0),
    unit: z.enum(["days", "hours", "minutes", "months", "years"]).default("days"),
  }),
  z.object({
    // Summarize — group items by a field and count/sum another.
    type: z.literal("summarize"),
    groupBy: z.string(),
    operation: z.enum(["count", "sum"]).default("count"),
    field: z.string().optional(),
  }),
  z.object({
    // Slack — post a message via chat.postMessage (needs a slackApi credential).
    type: z.literal("slack"),
    credentialId: z.string(),
    channel: z.string(),
    text: z.string(),
  }),
]);
export type NodeConfig = z.infer<typeof nodeConfig>;

export const workflowNode = z.object({
  id: z.string(),
  type: nodeType,
  position: z.object({ x: z.number(), y: z.number() }),
  label: z.string(),
  notes: z.string().optional(),
  config: nodeConfig,
});
export type WorkflowNode = z.infer<typeof workflowNode>;

export const workflowEdge = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string().optional(),
  target: z.string(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof workflowEdge>;

export const workflowGraph = z
  .object({
    nodes: z.array(workflowNode),
    edges: z.array(workflowEdge),
  })
  .refine(
    (g) => {
      const ids = new Set(g.nodes.map((n) => n.id));
      return g.edges.every((e) => ids.has(e.source) && ids.has(e.target));
    },
    { message: "Every edge must reference existing node ids." },
  );
export type WorkflowGraph = z.infer<typeof workflowGraph>;
