import type { NodeType, WorkflowGraph, WorkflowNode } from "@agentik/workflow-schema";

/** Context handed to every node executor. */
export interface NodeContext {
  node: WorkflowNode;
  /** Merged output of the node's upstream(s); the trigger payload for entry nodes. */
  input: unknown;
  /** The run's trigger payload, always reachable regardless of position. */
  payload: unknown;
  /** All node outputs produced so far, keyed by node id. */
  outputs: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}

export interface NodeExecutor {
  type: NodeType;
  execute(ctx: NodeContext): Promise<unknown>;
}

export type StepStatusOut = "succeeded" | "failed" | "skipped";

export interface StepStartEvent {
  index: number;
  nodeId: string;
  nodeType: string;
  label: string;
  input: unknown;
}

export interface StepFinishEvent {
  index: number;
  nodeId: string;
  nodeType: string;
  label: string;
  status: StepStatusOut;
  output: unknown;
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
  hooks?: ExecutionHooks;
  signal?: AbortSignal;
  /** Override / extend the node registry (e.g. inject an agent node with an API key). */
  executors?: NodeExecutor[];
}

export interface ExecuteResult {
  status: "succeeded" | "failed";
  error?: string;
  /** Output of each executed node, keyed by node id. */
  outputs: Record<string, unknown>;
}
