import type { NodeType, WorkflowGraph, WorkflowNode } from "@agentik/workflow-schema";
import type { INodeExecutionData, NodeOutput } from "./items";
import type { ExprScope } from "./expressions";

/** Context handed to every node executor (n8n item model). */
export interface NodeContext {
  node: WorkflowNode;
  /** All input items on the main port (n8n: `this.getInputData()`). */
  input: INodeExecutionData[];
  /** Input items grouped by input port (targetHandle); main port under "main". */
  inputsByPort: Readonly<Record<string, INodeExecutionData[]>>;
  /** The run's trigger payload, always reachable regardless of position. */
  payload: unknown;
  /** node id → that node's output items (concatenated across ports). */
  nodeOutputs: Readonly<Record<string, INodeExecutionData[]>>;
  /** node id → display label, for `$('Label')` resolution. */
  nodeNames: Readonly<Record<string, string>>;
  runId: string;
  workflowName?: string;
  /** Resolve a stored credential's secrets by id (decrypted by the host). */
  resolveCredential: CredentialResolver;
  signal?: AbortSignal;
}

/** Resolves a credential id to its decrypted secret map (null if absent). */
export type CredentialResolver = (id: string) => Promise<Record<string, string> | null>;

/** Context for a single item, handed to `executeItem`. */
export interface PerItemContext extends NodeContext {
  item: INodeExecutionData;
  itemIndex: number;
}

export interface NodeExecutor {
  type: NodeType;
  /**
   * Run once for ALL input items. Return either an item array (single "main"
   * output) or a port→items map for branching nodes (e.g. IF/Switch).
   * A node provides exactly one of `execute` / `executeItem`.
   */
  execute?(ctx: NodeContext): Promise<INodeExecutionData[] | NodeOutput>;
  /**
   * Run once PER input item. Return a json object, a full item, or an item
   * array (single "main" output). The engine loops the items and sets
   * `pairedItem` automatically.
   */
  executeItem?(ctx: PerItemContext): Promise<unknown>;
}

/** Build an expression scope for one item from a node context. */
export function exprScope(ctx: NodeContext, itemIndex: number): ExprScope {
  return {
    items: ctx.input,
    itemIndex,
    payload: ctx.payload,
    nodeOutputs: ctx.nodeOutputs,
    nodeNames: ctx.nodeNames,
    runId: ctx.runId,
    workflowName: ctx.workflowName,
  };
}

export type StepStatusOut = "succeeded" | "failed" | "skipped";

export interface StepStartEvent {
  index: number;
  nodeId: string;
  nodeType: string;
  label: string;
  /** Input items handed to the node. */
  input: INodeExecutionData[];
}

export interface StepFinishEvent {
  index: number;
  nodeId: string;
  nodeType: string;
  label: string;
  status: StepStatusOut;
  /** Output items produced by the node (concatenated across ports). */
  output: INodeExecutionData[] | null;
  error?: string;
  durationMs: number;
}

export interface ExecutionHooks {
  onStepStart?(ev: StepStartEvent): Promise<void> | void;
  onStepFinish?(ev: StepFinishEvent): Promise<void> | void;
}

export interface ExecuteOptions {
  graph: WorkflowGraph;
  payload?: unknown;
  runId?: string;
  workflowName?: string;
  hooks?: ExecutionHooks;
  signal?: AbortSignal;
  /** Override / extend the node registry (e.g. inject an agent node with an API key). */
  executors?: NodeExecutor[];
  /** Resolve credential secrets by id (the host reads + decrypts them). */
  resolveCredential?: CredentialResolver;
}

export interface ExecuteResult {
  status: "succeeded" | "failed";
  error?: string;
  /** Output items of each executed node, keyed by node id. */
  outputs: Record<string, INodeExecutionData[]>;
}
