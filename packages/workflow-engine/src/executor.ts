import type { WorkflowEdge } from "@agentik/workflow-schema";
import type { ExecuteOptions, ExecuteResult, NodeContext } from "./types";
import { topoSort } from "./topo";
import { buildRegistry } from "./nodes";

/** Input handed to a node: single active upstream → its output; many → keyed by source. */
function computeInput(
  sources: string[],
  outputs: Readonly<Record<string, unknown>>,
  payload: unknown,
): unknown {
  if (sources.length === 0) return payload ?? {};
  if (sources.length === 1) return outputs[sources[0]!];
  return Object.fromEntries(sources.map((id) => [id, outputs[id]]));
}

/**
 * Execute a workflow graph in topological order with conditional branching.
 *
 * A node runs only when it is "reached" — it is a trigger, or at least one of
 * its incoming edges is active. Normal nodes activate all their outgoing edges;
 * branching nodes (those exposing `route()`, e.g. decision) activate only the
 * edges leaving the chosen handle, so untaken branches are skipped. The first
 * failure stops the run. Per-step progress is surfaced via hooks.
 */
export async function executeWorkflow(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { graph, payload, hooks, signal } = opts;
  const registry = buildRegistry(opts.executors);
  const outputs: Record<string, unknown> = {};

  let order: string[];
  try {
    ({ order } = topoSort(graph));
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), outputs };
  }

  const orderSet = new Set(order);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const incomingEdges = new Map<string, WorkflowEdge[]>();
  const outgoingEdges = new Map<string, WorkflowEdge[]>();
  const push = (map: Map<string, WorkflowEdge[]>, key: string, edge: WorkflowEdge) => {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  };
  for (const e of graph.edges) {
    if (!orderSet.has(e.source) || !orderSet.has(e.target)) continue;
    push(incomingEdges, e.target, e);
    push(outgoingEdges, e.source, e);
  }

  const activeEdges = new Set<string>();

  let index = 0;
  for (const nodeId of order) {
    if (signal?.aborted) return { status: "failed", error: "Run cancelled.", outputs };

    const node = nodesById.get(nodeId)!;
    const inEdges = incomingEdges.get(nodeId) ?? [];
    const activeIn = inEdges.filter((e) => activeEdges.has(e.id));
    const reached = node.type === "trigger" || activeIn.length > 0;
    if (!reached) continue; // node on an untaken branch — silently skipped

    const input = computeInput(activeIn.map((e) => e.source), outputs, payload);
    const ctx: NodeContext = { node, input, payload, outputs, signal };
    const base = { index, nodeId, nodeType: node.type, label: node.label };

    await hooks?.onStepStart?.({ ...base, input });
    const startedAt = performance.now();
    const executor = registry.get(node.type);

    if (!executor) {
      const error = `No executor for node type "${node.type}" (not implemented yet).`;
      await hooks?.onStepFinish?.({ ...base, status: "failed", output: null, error, durationMs: Math.round(performance.now() - startedAt) });
      return { status: "failed", error, outputs };
    }

    let chosenHandle: string | null = null;
    try {
      const output = await executor.execute(ctx);
      // route() before recording the output so a branching node's expressions
      // don't see its own (pass-through) output under `outputs[self]`.
      if (executor.route) chosenHandle = await executor.route(ctx);
      outputs[nodeId] = output;
      await hooks?.onStepFinish?.({ ...base, status: "succeeded", output, durationMs: Math.round(performance.now() - startedAt) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const output = (err as { output?: unknown })?.output ?? null;
      await hooks?.onStepFinish?.({ ...base, status: "failed", output, error, durationMs: Math.round(performance.now() - startedAt) });
      return { status: "failed", error, outputs };
    }

    // Activate downstream edges: all of them, or only the chosen branch.
    for (const e of outgoingEdges.get(nodeId) ?? []) {
      if (chosenHandle === null || (e.sourceHandle ?? "default") === chosenHandle) {
        activeEdges.add(e.id);
      }
    }
    index++;
  }

  return { status: "succeeded", outputs };
}
