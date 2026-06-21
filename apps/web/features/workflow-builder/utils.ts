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
      return {
        type: "agent",
        model: "gpt-4.1-mini",
        instructions: "You are a helpful assistant inside a workflow. Respond concisely.",
        prompt: "{{ JSON.stringify(input) }}",
        inputMap: {},
        timeoutMs: 60_000,
      };
    case "tool":
      return { type: "tool", toolId: "" as never, action: "", argsMap: {}, scopes: [] };
    case "api":
      return { type: "api", method: "GET", url: "", timeoutMs: 30_000 };
    case "decision":
      return { type: "decision", branches: [{ label: "Yes", expression: "true" }], default: "No" };
    case "approval":
      return { type: "approval", approverRole: "admin", message: "Please review", timeoutMs: 86_400_000, onTimeout: "reject" };
    case "code":
      return { type: "code", language: "js", source: "// your code here\n// items in scope: $input.all(); current item: $json\nreturn $input.all();" };
    case "loop":
      return { type: "loop", collection: "items", concurrency: 1, maxIterations: 100 };
    case "subflow":
      return { type: "subflow", workflowId: "" as never, versionId: "live", inputMap: {} };
    case "end":
      return { type: "end" };
    case "set":
      return { type: "set", assignments: [{ name: "field", value: "{{ $json.value }}" }], keepOnlySet: false };
    case "filter":
      return { type: "filter", condition: "$json.value != null" };
    case "limit":
      return { type: "limit", maxItems: 1, keep: "first" };
    case "merge":
      return { type: "merge", mode: "append" };
    case "noop":
      return { type: "noop" };
    case "sort":
      return { type: "sort", field: "value", order: "asc" };
    case "aggregate":
      return { type: "aggregate" };
    case "splitOut":
      return { type: "splitOut", field: "items" };
    case "removeDuplicates":
      return { type: "removeDuplicates" };
    case "renameKeys":
      return { type: "renameKeys", renames: [{ from: "old", to: "new" }] };
    case "crypto":
      return { type: "crypto", action: "hash", algorithm: "sha256", value: "{{ $json.value }}", field: "hash" };
    case "dateTime":
      return { type: "dateTime", action: "format", outputField: "date", format: "yyyy-MM-dd", amount: 0, unit: "days" };
    case "summarize":
      return { type: "summarize", groupBy: "category", operation: "count" };
    case "slack":
      return { type: "slack", credentialId: "", channel: "#general", text: "{{ $json.message }}" };
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
  const trigger = createNode("trigger", { x: 80, y: 250 }, "Manual trigger");
  const end = createNode("end", { x: 430, y: 250 });
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
