import type { NodeExecutor } from "../types";
import { triggerNode } from "./trigger";
import { apiNode } from "./api";
import { codeNode } from "./code";
import { endNode } from "./end";
import { decisionNode } from "./decision";

export { createAgentNode, type AgentNodeOptions } from "./agent";

/**
 * Node types the engine executes without extra config. The agent node is NOT
 * here — it needs an API key, so the worker injects it via createAgentNode().
 */
export const builtinExecutors: NodeExecutor[] = [
  triggerNode,
  apiNode,
  codeNode,
  endNode,
  decisionNode,
];

export function buildRegistry(extra: NodeExecutor[] = []): Map<string, NodeExecutor> {
  const map = new Map<string, NodeExecutor>();
  for (const e of builtinExecutors) map.set(e.type, e);
  for (const e of extra) map.set(e.type, e); // overrides win
  return map;
}

export { triggerNode, apiNode, codeNode, endNode, decisionNode };
