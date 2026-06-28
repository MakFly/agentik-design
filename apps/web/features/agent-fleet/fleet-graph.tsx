"use client";

import { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { AgentNode } from "./agent-node";
import { RosterEdge, type RosterEdgeData } from "./roster-edge";
import { useReassignRoster, type FleetGraph, type FleetNode, type RosterInput } from "./api";

const nodeTypes: NodeTypes = { agent: AgentNode };
const edgeTypes: EdgeTypes = { roster: RosterEdge };

const COL_GAP = 220;
const ROW_GAP = 150;

type AgentFlowNode = Node<FleetNode, "agent">;

/**
 * Layered top-down auto-layout (no dagre/elkjs): depth 0 = orchestrators and any
 * node with no incoming roster edge; each subagent sits at parent depth + 1
 * (first-seen wins, so cycles and multi-parent nodes still terminate).
 */
function layout(graph: FleetGraph): AgentFlowNode[] {
  const childIds = new Set(graph.rosterEdges.map((e) => e.subagentId));
  const childrenOf = new Map<string, string[]>();
  for (const e of graph.rosterEdges) {
    const list = childrenOf.get(e.parentAgentId) ?? [];
    list.push(e.subagentId);
    childrenOf.set(e.parentAgentId, list);
  }

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of graph.nodes) {
    if (n.isOrchestrator || !childIds.has(n.id)) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  }
  // Any node still unplaced (only reachable through a cycle) starts at depth 0 too.
  for (const n of graph.nodes) if (!depth.has(n.id)) { depth.set(n.id, 0); queue.push(n.id); }

  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const child of childrenOf.get(id) ?? []) {
      if (!depth.has(child) || depth.get(child)! <= d) {
        if (depth.get(child) === d + 1) continue;
        depth.set(child, d + 1);
        queue.push(child);
      }
    }
  }

  const perLayer = new Map<number, number>();
  return graph.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const idx = perLayer.get(d) ?? 0;
    perLayer.set(d, idx + 1);
    return {
      id: n.id,
      type: "agent" as const,
      position: { x: idx * COL_GAP, y: d * ROW_GAP },
      data: n,
    };
  });
}

function FleetGraphInner({
  graph,
  team,
  onSelect,
}: {
  graph: FleetGraph;
  team: string;
  onSelect: (id: string) => void;
}) {
  const reassign = useReassignRoster(team);

  const rosterOf = useCallback(
    (parentId: string): RosterInput[] =>
      graph.rosterEdges
        .filter((e) => e.parentAgentId === parentId)
        .map((e, i) => ({ agentId: e.subagentId, instruction: e.instruction, position: i })),
    [graph.rosterEdges],
  );

  const removeLink = useCallback(
    (parentId: string, childId: string) => {
      if (!window.confirm("Remove this delegation link?")) return;
      const next = rosterOf(parentId).filter((s) => s.agentId !== childId);
      reassign.mutate(
        { parentId, subagents: next },
        {
          onSuccess: () => toast.success("Delegation removed"),
          onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove link"),
        },
      );
    },
    [reassign, rosterOf],
  );

  const nodes = useMemo(() => layout(graph), [graph]);

  const edges = useMemo<Edge<RosterEdgeData, "roster">[]>(
    () =>
      graph.rosterEdges.map((e) => ({
        id: `${e.parentAgentId}->${e.subagentId}`,
        source: e.parentAgentId,
        target: e.subagentId,
        type: "roster",
        animated: true,
        data: {
          instruction: e.instruction,
          onRemove: () => removeLink(e.parentAgentId, e.subagentId),
        },
      })),
    [graph.rosterEdges, removeLink],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const parentId = c.source;
      const current = rosterOf(parentId);
      if (current.some((s) => s.agentId === c.target)) return;
      const next = [...current, { agentId: c.target, position: current.length }];
      reassign.mutate(
        { parentId, subagents: next },
        {
          onSuccess: () => toast.success("Delegation added"),
          onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add link"),
        },
      );
    },
    [reassign, rosterOf],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => onSelect(node.id),
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      deleteKeyCode={null}
      nodesDraggable
      className="!bg-surface-2"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
      <Controls showInteractive={false} position="bottom-left" className="!hidden md:!flex" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        className="!hidden md:!block"
        maskColor="var(--overlay)"
        nodeColor="var(--surface-3)"
      />
    </ReactFlow>
  );
}

export function FleetGraph({
  graph,
  team,
  onSelect,
}: {
  graph: FleetGraph;
  team: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="h-[70dvh] min-h-[28rem] w-full overflow-hidden rounded-lg border border-border">
      <ReactFlowProvider>
        <FleetGraphInner graph={graph} team={team} onSelect={onSelect} />
      </ReactFlowProvider>
    </div>
  );
}
