import type { Node, Edge } from "@xyflow/react";
import type { NodeType, NodeConfig } from "@/types/domain";
import { NODE_TYPE_CONFIGS } from "./constants";

let counter = 0;
export function nodeId(): string {
  return `n_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

export function edgeId(source: string, target: string): string {
  return `e_${source}_${target}`;
}

function defaultConfigForType(type: NodeType): NodeConfig {
  switch (type) {
    case "trigger":
      return { type: "trigger", trigger: "manual" };
    case "agent":
      return { type: "agent", agentId: "" as never, versionId: "live", inputMap: {}, onError: { onError: "fail" }, timeoutMs: 60_000 };
    case "tool":
      return { type: "tool", toolId: "" as never, action: "", argsMap: {}, scopes: [] };
    case "api":
      return { type: "api", method: "GET", url: "", timeoutMs: 30_000 };
    case "decision":
      return { type: "decision", branches: [{ label: "Yes", expression: "true" }], default: "No" };
    case "approval":
      return { type: "approval", approverRole: "admin", message: "Please review", timeoutMs: 86_400_000, onTimeout: "reject" };
    case "code":
      return { type: "code", language: "js", source: "// your code here\nreturn input;" };
    case "loop":
      return { type: "loop", collection: "items", concurrency: 1, maxIterations: 100 };
    case "subflow":
      return { type: "subflow", workflowId: "" as never, versionId: "live", inputMap: {} };
    case "end":
      return { type: "end" };
  }
}

export function createNode(
  type: NodeType,
  position: { x: number; y: number },
  labelOverride?: string,
): Node {
  const cfg = NODE_TYPE_CONFIGS[type];
  return {
    id: nodeId(),
    type: "workflow",
    position,
    data: {
      nodeType: type,
      label: labelOverride ?? cfg.label,
      config: defaultConfigForType(type),
    },
  };
}

export function createInitialNodes(): { nodes: Node[]; edges: Edge[] } {
  const trigger = createNode("trigger", { x: 200, y: 250 }, "Manual trigger");
  const end = createNode("end", { x: 600, y: 250 });
  return {
    nodes: [trigger, end],
    edges: [
      {
        id: edgeId(trigger.id, end.id),
        source: trigger.id,
        target: end.id,
        type: "workflow",
      },
    ],
  };
}
