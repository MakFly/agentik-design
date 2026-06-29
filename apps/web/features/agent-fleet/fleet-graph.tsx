"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./fleet-canvas.css";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { AgentNode } from "./agent-node";
import { layoutFleetGraph, type AgentFlowNode } from "./fleet-graph-layout";
import {
  loadFleetLayout,
  positionsFromNodes,
  saveFleetLayout,
} from "./fleet-layout-storage";
import { RosterEdge, type RosterEdgeData } from "./roster-edge";
import { useReassignRoster, type FleetGraph, type RosterInput } from "./api";

const nodeTypes: NodeTypes = { agent: AgentNode };
const edgeTypes: EdgeTypes = { roster: RosterEdge };

function graphFingerprint(graph: FleetGraph) {
  return JSON.stringify({
    nodes: graph.nodes.map((n) => n.id).sort(),
    edges: graph.rosterEdges
      .map((e) => `${e.parentAgentId}->${e.subagentId}:${e.instruction ?? ""}`)
      .sort(),
  });
}

function mergeNodes(
  graph: FleetGraph,
  hideUnassigned: boolean,
  team: string,
  prev: AgentFlowNode[],
): AgentFlowNode[] {
  const laidOut = layoutFleetGraph(graph);
  const filtered = hideUnassigned ? laidOut.filter((n) => !n.data.isUnassigned) : laidOut;
  const saved = loadFleetLayout(team);
  const prevPos = new Map(prev.map((n) => [n.id, n.position]));

  return filtered.map((n) => ({
    ...n,
    position: prevPos.get(n.id) ?? saved[n.id] ?? n.position,
  }));
}

function FleetGraphInner({
  graph,
  team,
  onSelect,
  hideUnassigned,
}: {
  graph: FleetGraph;
  team: string;
  onSelect: (id: string) => void;
  hideUnassigned: boolean;
}) {
  const reassign = useReassignRoster(team);
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const fittedRef = useRef(false);
  const fingerprint = useMemo(() => graphFingerprint(graph), [graph]);

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

  // Sync node data when the graph changes; keep user-dragged positions.
  useEffect(() => {
    setNodes((prev) => mergeNodes(graph, hideUnassigned, team, prev));
  }, [fingerprint, graph, hideUnassigned, team, setNodes]);

  // Fit once on first paint when there is no saved layout.
  useEffect(() => {
    if (fittedRef.current || nodes.length === 0) return;
    const saved = loadFleetLayout(team);
    if (Object.keys(saved).length > 0) {
      fittedRef.current = true;
      return;
    }
    const id = requestAnimationFrame(() => {
      fitView({ padding: 0.35, maxZoom: 1.1 });
      fittedRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [nodes.length, team, fitView]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<AgentFlowNode>[]) => {
      onNodesChange(changes);
      const dragEnded = changes.some(
        (c) => c.type === "position" && "dragging" in c && c.dragging === false,
      );
      if (!dragEnded) return;
      const next = applyNodeChanges(changes, nodesRef.current);
      saveFleetLayout(team, positionsFromNodes(next));
    },
    [onNodesChange, team],
  );

  const visibleIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const edges = useMemo<Edge<RosterEdgeData, "roster">[]>(
    () =>
      graph.rosterEdges
        .filter((e) => visibleIds.has(e.parentAgentId) && visibleIds.has(e.subagentId))
        .map((e) => ({
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
    [graph.rosterEdges, removeLink, visibleIds],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const parentId = c.source;
      const parent = graph.nodes.find((n) => n.id === parentId);
      if (!parent?.isOrchestrator) {
        toast.error("Only orchestrators can delegate — mark the source agent as an orchestrator first.");
        return;
      }
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
    [graph.nodes, reassign, rosterOf],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => onSelect(node.id),
    [onSelect],
  );

  const poolCount = graph.nodes.filter((n) => {
    const childIds = new Set(graph.rosterEdges.map((e) => e.subagentId));
    const parentIds = new Set(graph.rosterEdges.map((e) => e.parentAgentId));
    return !childIds.has(n.id) && !parentIds.has(n.id);
  }).length;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      proOptions={{ hideAttribution: true }}
      deleteKeyCode={null}
      nodesDraggable
      snapToGrid
      snapGrid={[20, 20]}
      className="fleet-canvas !bg-[var(--fleet-canvas)]"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--fleet-dot)" />
      <Panel position="top-left" className="!m-3 max-w-sm">
        <p className="flex items-start gap-2 rounded-lg border border-border/80 bg-surface/95 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          Drag cards to arrange the canvas. Wire delegation from an orchestrator&apos;s bottom handle to an operator.
        </p>
      </Panel>
      {poolCount > 0 && hideUnassigned ? (
        <Panel position="top-right" className="!m-3">
          <p className="rounded-full border border-border bg-surface/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
            {poolCount} unassigned hidden
          </p>
        </Panel>
      ) : null}
      <Controls showInteractive={false} position="bottom-left" className="!hidden md:!flex" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        className="!hidden md:!block"
        maskColor="var(--overlay)"
        nodeColor={(n) => (n.data?.isUnassigned ? "var(--muted)" : "var(--primary)")}
        nodeStrokeWidth={2}
      />
    </ReactFlow>
  );
}

export function FleetGraph({
  graph,
  team,
  onSelect,
  hideUnassigned,
}: {
  graph: FleetGraph;
  team: string;
  onSelect: (id: string) => void;
  hideUnassigned?: boolean;
}) {
  return (
    <div className="relative h-[min(72dvh,40rem)] min-h-[24rem] w-full overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <ReactFlowProvider>
        <FleetGraphInner graph={graph} team={team} onSelect={onSelect} hideUnassigned={hideUnassigned ?? false} />
      </ReactFlowProvider>
    </div>
  );
}
