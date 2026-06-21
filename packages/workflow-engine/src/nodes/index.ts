import type { NodeExecutor } from "../types";
import { triggerNode } from "./trigger";
import { apiNode } from "./api";
import { codeNode } from "./code";
import { endNode } from "./end";

/** Node types the engine can execute today. */
export const builtinExecutors: NodeExecutor[] = [triggerNode, apiNode, codeNode, endNode];

export function buildRegistry(extra: NodeExecutor[] = []): Map<string, NodeExecutor> {
  const map = new Map<string, NodeExecutor>();
  for (const e of builtinExecutors) map.set(e.type, e);
  for (const e of extra) map.set(e.type, e); // overrides win
  return map;
}

export { triggerNode, apiNode, codeNode, endNode };
