import { describe, expect, test } from "bun:test";
import type { WorkflowGraph } from "@agentik/workflow-schema";
import { executeWorkflow } from "./executor";
import { topoSort } from "./topo";
import { resolveTemplate, type ExprScope } from "./expressions";
import type { INodeExecutionData } from "./items";
import type { StepFinishEvent } from "./types";

function graph(nodes: WorkflowGraph["nodes"], edges: WorkflowGraph["edges"] = []): WorkflowGraph {
  return { nodes, edges };
}

const trigger = (id: string): WorkflowGraph["nodes"][number] => ({
  id,
  type: "trigger",
  position: { x: 0, y: 0 },
  label: "Trigger",
  config: { type: "trigger", trigger: "manual" },
});

const code = (
  id: string,
  source: string,
  mode: "all" | "each" = "all",
): WorkflowGraph["nodes"][number] => ({
  id,
  type: "code",
  position: { x: 0, y: 0 },
  label: `Code ${id}`,
  config: { type: "code", language: "js", source, mode },
});

const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

/** First item's json of a node output. */
const json = (items: INodeExecutionData[] | undefined) => items?.[0]?.json;

describe("topoSort", () => {
  test("orders linear graph from the trigger", () => {
    const g = graph([trigger("t"), code("a", "return 1"), code("b", "return 2")], [edge("t", "a"), edge("a", "b")]);
    expect(topoSort(g).order).toEqual(["t", "a", "b"]);
  });

  test("throws when there is no trigger", () => {
    expect(() => topoSort(graph([code("a", "return 1")]))).toThrow(/trigger/i);
  });

  test("throws on a cycle", () => {
    const g = graph([trigger("t"), code("a", "return 1"), code("b", "return 2")], [
      edge("t", "a"),
      edge("a", "b"),
      edge("b", "a"),
    ]);
    expect(() => topoSort(g)).toThrow(/cycle/i);
  });

  test("skips nodes unreachable from a trigger", () => {
    const g = graph([trigger("t"), code("a", "return 1"), code("orphan", "return 9")], [edge("t", "a")]);
    expect(topoSort(g).order).toEqual(["t", "a"]);
  });
});

describe("resolveTemplate", () => {
  const scope: ExprScope = {
    items: [{ json: { n: 21 } }],
    itemIndex: 0,
    payload: { name: "ada" },
    nodeOutputs: {},
    nodeNames: {},
    runId: "run",
  };
  test("returns raw value for a single expression ($json)", () => {
    expect(resolveTemplate("{{ $json.n * 2 }}", scope)).toBe(42);
  });
  test("legacy `input` alias maps to the current item json", () => {
    expect(resolveTemplate("{{ input.n * 2 }}", scope)).toBe(42);
  });
  test("interpolates into a string from payload", () => {
    expect(resolveTemplate("hi {{ payload.name }}!", scope)).toBe("hi ada!");
  });
  test("$input.all() exposes the item array", () => {
    expect(resolveTemplate("{{ $input.all().length }}", scope)).toBe(1);
  });
  test("$now / $today are Luxon DateTime (n8n)", () => {
    const fixed: ExprScope = { ...scope, now: new Date("2026-06-21T12:00:00Z") };
    expect(resolveTemplate("{{ $now.year }}", fixed)).toBe(2026);
    expect(resolveTemplate("{{ $today.hour }}", fixed)).toBe(0);
    expect(resolveTemplate("{{ $now.toFormat('yyyy') }}", fixed)).toBe("2026");
  });
});

describe("executeWorkflow — item model", () => {
  test("trigger emits the payload as one item; code reads $json", async () => {
    const g = graph([trigger("t"), code("double", "return { doubled: $json.n * 2 }")], [edge("t", "double")]);
    const result = await executeWorkflow({ graph: g, payload: { n: 5 } });
    expect(result.status).toBe("succeeded");
    expect(json(result.outputs.double)).toEqual({ doubled: 10 });
  });

  test("array payload becomes one item per element; code 'each' maps with pairedItem", async () => {
    const g = graph([trigger("t"), code("dbl", "return { d: $json.n * 2 }", "each")], [edge("t", "dbl")]);
    const result = await executeWorkflow({ graph: g, payload: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    expect(result.status).toBe("succeeded");
    const out = result.outputs.dbl!;
    expect(out.map((i) => i.json)).toEqual([{ d: 2 }, { d: 4 }, { d: 6 }]);
    expect(out.map((i) => i.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
  });

  test("emits a step event per executed node with item arrays", async () => {
    const g = graph([trigger("t"), code("a", "return $json")], [edge("t", "a")]);
    const finished: StepFinishEvent[] = [];
    await executeWorkflow({
      graph: g,
      payload: {},
      hooks: { onStepFinish: (ev) => void finished.push(ev) },
    });
    expect(finished.map((e) => e.nodeId)).toEqual(["t", "a"]);
    expect(finished.every((e) => e.status === "succeeded")).toBe(true);
    expect(Array.isArray(finished[0]!.output)).toBe(true);
  });

  test("stops and fails on a node error", async () => {
    const g = graph([trigger("t"), code("boom", "throw new Error('nope')"), code("after", "return 1")], [
      edge("t", "boom"),
      edge("boom", "after"),
    ]);
    const result = await executeWorkflow({ graph: g, payload: {} });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/nope/);
    expect(result.outputs.after).toBeUndefined();
  });

  test("end node passes its input items through", async () => {
    const end = (id: string): WorkflowGraph["nodes"][number] => ({
      id,
      type: "end",
      position: { x: 0, y: 0 },
      label: "End",
      config: { type: "end" },
    });
    const g = graph([trigger("t"), end("e")], [edge("t", "e")]);
    const result = await executeWorkflow({ graph: g, payload: { ok: 1 } });
    expect(result.status).toBe("succeeded");
    expect(json(result.outputs.e)).toEqual({ ok: 1 });
  });
});

describe("executeWorkflow — decision (per-item Switch)", () => {
  const decision = (id: string): WorkflowGraph["nodes"][number] => ({
    id,
    type: "decision",
    position: { x: 0, y: 0 },
    label: "Branch",
    config: { type: "decision", branches: [{ label: "big", expression: "$json.n > 3" }], default: "small" },
  });
  const handleEdge = (source: string, handle: string, target: string) => ({
    id: `${source}:${handle}->${target}`,
    source,
    sourceHandle: handle,
    target,
  });
  const g = graph(
    [trigger("t"), decision("d"), code("big", "return { took: 'big' }"), code("small", "return { took: 'small' }")],
    [edge("t", "d"), handleEdge("d", "big", "big"), handleEdge("d", "small", "small")],
  );

  test("routes a single item to the matching branch, skips the other", async () => {
    const big = await executeWorkflow({ graph: g, payload: { n: 5 } });
    expect(json(big.outputs.big)).toEqual({ took: "big" });
    expect(big.outputs.small).toBeUndefined();

    const small = await executeWorkflow({ graph: g, payload: { n: 1 } });
    expect(json(small.outputs.small)).toEqual({ took: "small" });
    expect(small.outputs.big).toBeUndefined();
  });

  test("partitions a mixed item array across both branches at once", async () => {
    const result = await executeWorkflow({ graph: g, payload: [{ n: 5 }, { n: 1 }, { n: 9 }] });
    expect(result.status).toBe("succeeded");
    // both downstream branches executed because each received ≥1 item
    expect(json(result.outputs.big)).toEqual({ took: "big" });
    expect(json(result.outputs.small)).toEqual({ took: "small" });
  });
});

describe("executeWorkflow — cross-node expression access", () => {
  test("$('Label') reaches an upstream node's output", async () => {
    const g = graph(
      [
        trigger("t"),
        code("seed", "return { base: 10 }"),
        code("use", "return { sum: $json.base + $('Code seed').first().json.base }"),
      ],
      [edge("t", "seed"), edge("seed", "use")],
    );
    const result = await executeWorkflow({ graph: g, payload: {} });
    expect(result.status).toBe("succeeded");
    expect(json(result.outputs.use)).toEqual({ sum: 20 });
  });

  test("fails gracefully when the graph has no trigger", async () => {
    const result = await executeWorkflow({ graph: graph([code("a", "return 1")]), payload: {} });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/trigger/i);
  });
});
