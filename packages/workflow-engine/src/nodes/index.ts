import type { NodeExecutor } from "../types";
import { triggerNode } from "./trigger";
import { apiNode } from "./api";
import { codeNode } from "./code";

/** Node types the engine can execute today (Phase 1). */
export const builtinExecutors: NodeExecutor[] = [triggerNode, apiNode, codeNode];

export function buildRegistry(extra: NodeExecutor[] = []): Map<string, NodeExecutor> {
  const map = new Map<string, NodeExecutor>();
  for (const e of builtinExecutors) map.set(e.type, e);
  for (const e of extra) map.set(e.type, e); // overrides win
  return map;
}

export { triggerNode, apiNode, codeNode };
