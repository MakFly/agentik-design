import type { NodeExecutor } from "../types";
import { triggerNode } from "./trigger";
import { apiNode } from "./api";
import { codeNode } from "./code";
import { endNode } from "./end";
import { decisionNode } from "./decision";
import { slackNode } from "./slack";
import {
  setNode,
  filterNode,
  limitNode,
  mergeNode,
  noopNode,
  sortNode,
  aggregateNode,
  splitOutNode,
  removeDuplicatesNode,
  renameKeysNode,
  cryptoNode,
  dateTimeNode,
  summarizeNode,
} from "./core";

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
  setNode,
  filterNode,
  limitNode,
  mergeNode,
  noopNode,
  sortNode,
  aggregateNode,
  splitOutNode,
  removeDuplicatesNode,
  renameKeysNode,
  cryptoNode,
  dateTimeNode,
  summarizeNode,
  slackNode,
];

export function buildRegistry(extra: NodeExecutor[] = []): Map<string, NodeExecutor> {
  const map = new Map<string, NodeExecutor>();
  for (const e of builtinExecutors) map.set(e.type, e);
  for (const e of extra) map.set(e.type, e); // overrides win
  return map;
}

export { triggerNode, apiNode, codeNode, endNode, decisionNode };
export { setNode, filterNode, limitNode, mergeNode, noopNode };
export { sortNode, aggregateNode, splitOutNode, removeDuplicatesNode, renameKeysNode, cryptoNode };
export { dateTimeNode, summarizeNode };
export { slackNode } from "./slack";
