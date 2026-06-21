import type { WorkflowGraph } from "@agentik/workflow-schema";

export interface TopoResult {
  /** Node ids in execution order (reachable from a trigger, cycle-free). */
  order: string[];
}

/**
 * Topological order of the nodes reachable from any trigger, via Kahn's
 * algorithm. Unreachable nodes are skipped. Cycles are rejected — a future loop
 * node will model iteration explicitly rather than via graph cycles. Edge wiring
 * (incoming/outgoing, handles) is rebuilt by the executor, which needs the full
 * edge objects, so it is intentionally not returned here.
 */
export function topoSort(graph: WorkflowGraph): TopoResult {
  const triggers = graph.nodes.filter((n) => n.type === "trigger").map((n) => n.id);
  if (triggers.length === 0) {
    throw new Error("Workflow has no trigger node.");
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of graph.nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of graph.edges) {
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }

  // Restrict to nodes reachable from a trigger.
  const reachable = new Set<string>();
  const stack = [...triggers];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of outgoing.get(id) ?? []) stack.push(next);
  }

  const indegree = new Map<string, number>();
  for (const id of reachable) {
    indegree.set(id, (incoming.get(id) ?? []).filter((s) => reachable.has(s)).length);
  }

  const queue = [...reachable].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      if (!reachable.has(next)) continue;
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  if (order.length !== reachable.size) {
    throw new Error("Workflow graph contains a cycle.");
  }

  return { order };
}
