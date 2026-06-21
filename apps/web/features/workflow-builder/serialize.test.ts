import { describe, expect, it } from "vitest";
import { fromGraph, toGraph } from "./serialize";
import { createInitialNodes } from "./utils";

describe("workflow graph serialization", () => {
  it("maps React Flow nodes to the engine contract", () => {
    const { nodes, edges } = createInitialNodes();
    const graph = toGraph(nodes, edges);

    expect(graph.nodes).toHaveLength(2);
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    expect(trigger).toBeDefined();
    expect(trigger?.config).toMatchObject({ type: "trigger", trigger: "manual" });
    expect(graph.edges[0]).toMatchObject({ source: nodes[0].id, target: nodes[1].id });
  });

  it("round-trips through fromGraph back to canvas nodes", () => {
    const { nodes, edges } = createInitialNodes();
    const restored = fromGraph(toGraph(nodes, edges));

    expect(restored.nodes.map((n) => n.id)).toEqual(nodes.map((n) => n.id));
    expect(restored.nodes[0].data).toMatchObject({ nodeType: "trigger" });
    expect(restored.nodes.every((n) => n.type === "workflow")).toBe(true);
    expect(restored.edges).toHaveLength(1);
  });
});
