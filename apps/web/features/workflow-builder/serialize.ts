import type { Edge, Node } from "@xyflow/react";
import type { NodeConfig, NodeType, WorkflowGraph } from "@agentik/workflow-schema";

/**
 * Bridge between the React Flow graph held in the builder store and the engine
 * contract (@agentik/workflow-schema). React Flow nodes carry domain data under
 * `data.{nodeType,label,config}`; the engine wants flat `{type,label,config}`.
 */

type BuilderNodeData = { nodeType: NodeType; label?: string; notes?: string; config: NodeConfig };

function nodeData(node: Node): BuilderNodeData {
  return node.data as BuilderNodeData;
}

export function toGraph(nodes: Node[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => {
      const data = nodeData(n);
      return {
        id: n.id,
        type: data.nodeType,
        position: { x: n.position.x, y: n.position.y },
        label: data.label ?? n.id,
        ...(data.notes ? { notes: data.notes } : {}),
        config: data.config,
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      ...(typeof e.label === "string" ? { label: e.label } : {}),
    })),
  };
}

export function fromGraph(graph: WorkflowGraph): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: "workflow",
      position: { x: n.position.x, y: n.position.y },
      data: { nodeType: n.type, label: n.label, notes: n.notes, config: n.config },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: "workflow",
    })),
  };
}
