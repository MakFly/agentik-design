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
    agentId: z.string(),
    versionId: z.string(),
    inputMap: ioMap.default({}),
    onError: nodeErrorPolicy,
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
]);
export type NodeConfig = z.infer<typeof nodeConfig>;

export const workflowNode = z.object({
  id: z.string(),
  type: nodeType,
  position: z.object({ x: z.number(), y: z.number() }),
  label: z.string(),
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
