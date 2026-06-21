import type { WorkflowEdge } from "@agentik/workflow-schema";
import type { ExecuteOptions, ExecuteResult, NodeContext, PerItemContext } from "./types";
import { type INodeExecutionData, type NodeOutput, MAIN, toItems } from "./items";
import { topoSort } from "./topo";
import { buildRegistry } from "./nodes";

/** Normalize an executor's return into a port→items map. Array → single "main". */
function toNodeOutput(result: INodeExecutionData[] | NodeOutput): NodeOutput {
  return Array.isArray(result) ? { [MAIN]: result } : result;
}

/** Flatten a node's per-port output into one item array (for expressions/result). */
function flatten(output: NodeOutput): INodeExecutionData[] {
  return Object.values(output).flat();
}

/**
 * Execute a workflow graph in topological order using n8n's item model.
 *
 * Every connection carries an **array of items**. A node's input is the
 * concatenation of the items its incoming edges deliver (each edge picks the
 * upstream's output port via `sourceHandle`). A non-trigger node runs only when
 * it has at least one input item — so a branch that produced zero items (e.g.
 * the untaken side of an IF) naturally skips its downstream nodes, exactly like
 * n8n. Nodes run once-for-all (`execute`) or once-per-item (`executeItem`, with
 * `pairedItem` linking set automatically). The first failure stops the run.
 */
export async function executeWorkflow(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { graph, payload, hooks, signal } = opts;
  const registry = buildRegistry(opts.executors);

  /** node id → output port → items. */
  const outputsByHandle: Record<string, NodeOutput> = {};
  /** node id → flattened output items (for expressions, hooks, result). */
  const outputs: Record<string, INodeExecutionData[]> = {};

  let order: string[];
  try {
    ({ order } = topoSort(graph));
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), outputs };
  }

  const orderSet = new Set(order);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodeNames: Record<string, string> = {};
  for (const n of graph.nodes) nodeNames[n.id] = n.label;

  const incomingEdges = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    if (!orderSet.has(e.source) || !orderSet.has(e.target)) continue;
    const list = incomingEdges.get(e.target);
    if (list) list.push(e);
    else incomingEdges.set(e.target, [e]);
  }

  const runId = opts.runId ?? "run";
  const workflowName = opts.workflowName;
  const resolveCredential = opts.resolveCredential ?? (async () => null);
  let index = 0;

  for (const nodeId of order) {
    if (signal?.aborted) return { status: "failed", error: "Run cancelled.", outputs };

    const node = nodesById.get(nodeId)!;

    // Gather input items, grouped by the target input port.
    const inputsByPort: Record<string, INodeExecutionData[]> = {};
    for (const e of incomingEdges.get(nodeId) ?? []) {
      const fromPort = e.sourceHandle ?? MAIN;
      const toPort = e.targetHandle ?? MAIN;
      const items = outputsByHandle[e.source]?.[fromPort] ?? [];
      (inputsByPort[toPort] ??= []).push(...items);
    }
    const input = inputsByPort[MAIN] ?? [];
    const totalInput = Object.values(inputsByPort).reduce((n, items) => n + items.length, 0);

    // n8n rule: a node runs iff it is a trigger or received at least one item.
    const reached = node.type === "trigger" || totalInput > 0;
    if (!reached) continue;

    const ctx: NodeContext = {
      node,
      input,
      inputsByPort,
      payload,
      nodeOutputs: outputs,
      nodeNames,
      runId,
      workflowName,
      resolveCredential,
      signal,
    };
    const base = { index, nodeId, nodeType: node.type, label: node.label };

    await hooks?.onStepStart?.({ ...base, input });
    const startedAt = performance.now();
    const executor = registry.get(node.type);

    if (!executor) {
      const error = `No executor for node type "${node.type}" (not implemented yet).`;
      await hooks?.onStepFinish?.({ ...base, status: "failed", output: null, error, durationMs: Math.round(performance.now() - startedAt) });
      return { status: "failed", error, outputs };
    }

    try {
      let output: NodeOutput;

      if (executor.execute) {
        output = toNodeOutput(await executor.execute(ctx));
      } else if (executor.executeItem) {
        // Run once per item; auto-link each output item to its source item.
        const collected: INodeExecutionData[] = [];
        for (let i = 0; i < input.length; i++) {
          const itemCtx: PerItemContext = { ...ctx, item: input[i]!, itemIndex: i };
          const produced = toItems(await executor.executeItem(itemCtx));
          for (const it of produced) collected.push({ ...it, pairedItem: { item: i } });
        }
        output = { [MAIN]: collected };
      } else {
        throw new Error(`Node type "${node.type}" has no execute/executeItem.`);
      }

      outputsByHandle[nodeId] = output;
      outputs[nodeId] = flatten(output);
      await hooks?.onStepFinish?.({ ...base, status: "succeeded", output: outputs[nodeId], durationMs: Math.round(performance.now() - startedAt) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const raw = (err as { output?: unknown })?.output;
      const output = raw === undefined ? null : toItems(raw);
      await hooks?.onStepFinish?.({ ...base, status: "failed", output, error, durationMs: Math.round(performance.now() - startedAt) });
      return { status: "failed", error, outputs };
    }

    index++;
  }

  return { status: "succeeded", outputs };
}
