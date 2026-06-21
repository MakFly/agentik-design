import { describe, expect, test } from "bun:test";
import type { WorkflowGraph } from "@agentik/workflow-schema";
import { executeWorkflow } from "./executor";
import { topoSort } from "./topo";
import { resolveTemplate } from "./expressions";
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

const code = (id: string, source: string): WorkflowGraph["nodes"][number] => ({
  id,
  type: "code",
  position: { x: 0, y: 0 },
  label: `Code ${id}`,
  config: { type: "code", language: "js", source },
});

const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

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
  const scope = { input: { n: 21 }, payload: { name: "ada" }, outputs: {} };
  test("returns raw value for a single expression", () => {
    expect(resolveTemplate("{{ input.n * 2 }}", scope)).toBe(42);
  });
  test("interpolates into a string", () => {
    expect(resolveTemplate("hi {{ payload.name }}!", scope)).toBe("hi ada!");
  });
});

describe("executeWorkflow", () => {
  test("passes data trigger → code and collects outputs", async () => {
    const g = graph([trigger("t"), code("double", "return { doubled: input.n * 2 }")], [edge("t", "double")]);
    const result = await executeWorkflow({ graph: g, payload: { n: 5 } });
    expect(result.status).toBe("succeeded");
    expect(result.outputs.double).toEqual({ doubled: 10 });
  });

  test("emits a step event per executed node", async () => {
    const g = graph([trigger("t"), code("a", "return input")], [edge("t", "a")]);
    const finished: StepFinishEvent[] = [];
    await executeWorkflow({
      graph: g,
      payload: {},
      hooks: { onStepFinish: (ev) => void finished.push(ev) },
    });
    expect(finished.map((e) => e.nodeId)).toEqual(["t", "a"]);
    expect(finished.every((e) => e.status === "succeeded")).toBe(true);
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

  test("runs the default trigger → end graph (end passes input through)", async () => {
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
    expect(result.outputs.e).toEqual({ ok: 1 });
  });

  test("fails gracefully when the graph has no trigger", async () => {
    const result = await executeWorkflow({ graph: graph([code("a", "return 1")]), payload: {} });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/trigger/i);
  });
});
