import type { ExecuteOptions, ExecuteResult } from "./types";
import { topoSort } from "./topo";
import { buildRegistry } from "./nodes";

/** Input handed to a node: single upstream → its output; many → keyed by source. */
function computeInput(
  upstreams: string[],
  outputs: Readonly<Record<string, unknown>>,
  payload: unknown,
): unknown {
  if (upstreams.length === 0) return payload ?? {};
  if (upstreams.length === 1) return outputs[upstreams[0]!];
  return Object.fromEntries(upstreams.map((id) => [id, outputs[id]]));
}

/**
 * Execute a workflow graph sequentially in topological order. On the first node
 * failure the run stops and returns "failed" (richer per-node error policies —
 * retry/continue/route — arrive in Phase 3). Per-step progress is surfaced via
 * hooks so the caller can persist run_steps and stream live status.
 */
export async function executeWorkflow(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { graph, payload, hooks, signal } = opts;
  const registry = buildRegistry(opts.executors);
  const outputs: Record<string, unknown> = {};

  let order: string[];
  let incoming: Map<string, string[]>;
  try {
    ({ order, incoming } = topoSort(graph));
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), outputs };
  }
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  let index = 0;
  for (const nodeId of order) {
    if (signal?.aborted) {
      return { status: "failed", error: "Run cancelled.", outputs };
    }
    const node = nodesById.get(nodeId)!;
    const input = computeInput(incoming.get(nodeId) ?? [], outputs, payload);
    const base = { index, nodeId, nodeType: node.type, label: node.label };

    await hooks?.onStepStart?.({ ...base, input });
    const startedAt = performance.now();
    const executor = registry.get(node.type);

    if (!executor) {
      const error = `No executor for node type "${node.type}" (not implemented yet).`;
      await hooks?.onStepFinish?.({
        ...base,
        status: "failed",
        output: null,
        error,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { status: "failed", error, outputs };
    }

    try {
      const output = await executor.execute({ node, input, payload, outputs, signal });
      outputs[nodeId] = output;
      await hooks?.onStepFinish?.({
        ...base,
        status: "succeeded",
        output,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const output = (err as { output?: unknown })?.output ?? null;
      await hooks?.onStepFinish?.({
        ...base,
        status: "failed",
        output,
        error,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { status: "failed", error, outputs };
    }
    index++;
  }

  return { status: "succeeded", outputs };
}
