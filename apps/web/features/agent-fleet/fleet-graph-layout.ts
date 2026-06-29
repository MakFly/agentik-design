import type { Node } from "@xyflow/react";
import type { FleetGraph, FleetNode } from "./api";

export type FleetNodeData = FleetNode & {
  /** Outgoing roster links (for orchestrator badge). */
  delegationCount: number;
  /** No roster in or out — shown in the side pool. */
  isUnassigned: boolean;
};

export type AgentFlowNode = Node<FleetNodeData, "agent">;

const COL_W = 220;
const ROW_H = 168;
const HUB_GAP = 72;
const POOL_GAP = 96;

function buildAdjacency(graph: FleetGraph) {
  const childIds = new Set(graph.rosterEdges.map((e) => e.subagentId));
  const parentIds = new Set(graph.rosterEdges.map((e) => e.parentAgentId));
  const connected = new Set([...childIds, ...parentIds]);
  const childrenOf = new Map<string, string[]>();
  const parentCount = new Map<string, number>();

  for (const e of graph.rosterEdges) {
    const list = childrenOf.get(e.parentAgentId) ?? [];
    list.push(e.subagentId);
    childrenOf.set(e.parentAgentId, list);
    parentCount.set(e.subagentId, (parentCount.get(e.subagentId) ?? 0) + 1);
  }

  const delegationCount = new Map<string, number>();
  for (const e of graph.rosterEdges) {
    delegationCount.set(e.parentAgentId, (delegationCount.get(e.parentAgentId) ?? 0) + 1);
  }

  const hubs = graph.nodes.filter(
    (n) => parentIds.has(n.id) || (n.isOrchestrator && !childIds.has(n.id)),
  );
  const pool = graph.nodes.filter((n) => !connected.has(n.id));
  const placed = new Set<string>();

  return { childIds, childrenOf, delegationCount, hubs, pool, placed, parentCount };
}

function nodeData(
  n: FleetNode,
  delegationCount: Map<string, number>,
  isUnassigned: boolean,
): FleetNodeData {
  return {
    ...n,
    delegationCount: delegationCount.get(n.id) ?? 0,
    isUnassigned,
  };
}

/**
 * Hub-and-spoke layout: each orchestrator (or parent with roster) gets a column
 * cluster; unconnected agents sit in a labeled pool on the right.
 */
export function layoutFleetGraph(graph: FleetGraph): AgentFlowNode[] {
  const { childrenOf, delegationCount, hubs, pool, placed } = buildAdjacency(graph);
  const nodes: AgentFlowNode[] = [];
  let hubX = 0;

  for (const hub of hubs) {
    const children = (childrenOf.get(hub.id) ?? []).filter((id) => graph.nodes.some((n) => n.id === id));
    const clusterW = Math.max(children.length, 1) * COL_W;

    nodes.push({
      id: hub.id,
      type: "agent",
      position: { x: hubX + clusterW / 2 - COL_W / 2, y: 0 },
      data: nodeData(hub, delegationCount, false),
    });
    placed.add(hub.id);

    children.forEach((childId, i) => {
      const child = graph.nodes.find((n) => n.id === childId);
      if (!child) return;
      const offset = (i - (children.length - 1) / 2) * COL_W;
      nodes.push({
        id: childId,
        type: "agent",
        position: { x: hubX + clusterW / 2 - COL_W / 2 + offset, y: ROW_H },
        data: nodeData(child, delegationCount, false),
      });
      placed.add(childId);
    });

    hubX += clusterW + HUB_GAP;
  }

  const poolX = hubX > 0 ? hubX + POOL_GAP : 0;
  pool.forEach((n, i) => {
    nodes.push({
      id: n.id,
      type: "agent",
      position: { x: poolX, y: i * ROW_H },
      data: nodeData(n, delegationCount, true),
    });
    placed.add(n.id);
  });

  // Fallback: anything not placed (multi-parent edge case, cycles).
  for (const n of graph.nodes) {
    if (placed.has(n.id)) continue;
    nodes.push({
      id: n.id,
      type: "agent",
      position: { x: hubX, y: 0 },
      data: nodeData(n, delegationCount, !delegationCount.has(n.id) && !(childrenOf.get(n.id)?.length)),
    });
    hubX += COL_W;
  }

  return nodes;
}

export function fleetSummary(graph: FleetGraph) {
  const childIds = new Set(graph.rosterEdges.map((e) => e.subagentId));
  const parentIds = new Set(graph.rosterEdges.map((e) => e.parentAgentId));
  const connected = new Set([...childIds, ...parentIds]);
  const orchestrators = graph.nodes.filter((n) => n.isOrchestrator).length;
  const unassigned = graph.nodes.filter((n) => !connected.has(n.id)).length;

  return {
    total: graph.nodes.length,
    orchestrators,
    delegations: graph.rosterEdges.length,
    unassigned,
    activeRuns: graph.runEdges.length,
  };
}
