import { beforeEach, describe, expect, it } from "vitest";
import { parseWorkflowSnapshot, planWorkflowRun, useWorkflowStore, workflowDraftStorageKey } from "./store";
import { createNode, edgeId } from "./utils";

function fresh(team = "acme") {
  window.localStorage.clear();
  useWorkflowStore.getState().resetDraft(team);
  window.localStorage.clear();
}

describe("workflow builder local draft persistence", () => {
  beforeEach(() => {
    fresh("acme");
    fresh("beta");
  });

  it("persists the workflow draft and hydrates it for the same team", () => {
    useWorkflowStore.getState().init("acme");

    const trigger = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "trigger");
    expect(trigger).toBeDefined();

    useWorkflowStore.getState().setWorkflowName("Lead qualification");
    useWorkflowStore.getState().setActive(true);
    useWorkflowStore.getState().addNode(
      createNode("agent", { x: 260, y: 250 }, "Score lead"),
      { connectFrom: trigger?.id, select: true },
    );

    expect(useWorkflowStore.getState().saveState).toBe("dirty");
    expect(useWorkflowStore.getState().persistDraft("acme")).toBe(true);

    const raw = window.localStorage.getItem(workflowDraftStorageKey("acme"));
    expect(raw).toBeTruthy();

    const saved = JSON.parse(raw ?? "{}") as { workflowName: string; active: boolean; nodes: unknown[]; edges: unknown[] };
    expect(saved.workflowName).toBe("Lead qualification");
    expect(saved.active).toBe(true);
    expect(saved.nodes).toHaveLength(3);
    expect(saved.edges).toHaveLength(2);

    useWorkflowStore.getState().init("acme");
    const rehydrated = useWorkflowStore.getState();

    expect(rehydrated.workflowName).toBe("Lead qualification");
    expect(rehydrated.active).toBe(true);
    expect(rehydrated.nodes).toHaveLength(3);
    expect(rehydrated.edges).toHaveLength(2);
    expect(rehydrated.selectedNodeId).toBeNull();
    expect(rehydrated.saveState).toBe("saved");
  });

  it("keeps drafts isolated per team", () => {
    useWorkflowStore.getState().init("acme");
    useWorkflowStore.getState().setWorkflowName("Acme workflow");
    expect(useWorkflowStore.getState().persistDraft("acme")).toBe(true);

    useWorkflowStore.getState().init("beta");

    expect(useWorkflowStore.getState().workflowName).toBe("Untitled workflow");
    expect(useWorkflowStore.getState().nodes).toHaveLength(2);
    expect(window.localStorage.getItem(workflowDraftStorageKey("acme"))).toBeTruthy();
    expect(window.localStorage.getItem(workflowDraftStorageKey("beta"))).toBeNull();
  });

  it("falls back to a clean workflow when the stored draft is invalid", () => {
    window.localStorage.setItem(workflowDraftStorageKey("acme"), "{not-json");

    useWorkflowStore.getState().init("acme");

    expect(useWorkflowStore.getState().workflowName).toBe("Untitled workflow");
    expect(useWorkflowStore.getState().nodes).toHaveLength(2);
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    expect(useWorkflowStore.getState().saveState).toBe("idle");
  });

  it("does not autosave React Flow measurement and selection updates", () => {
    useWorkflowStore.getState().init("acme");
    const firstNode = useWorkflowStore.getState().nodes[0];
    const firstEdge = useWorkflowStore.getState().edges[0];

    useWorkflowStore.getState().onNodesChange([
      { id: firstNode.id, type: "dimensions", dimensions: { width: 220, height: 66 } },
      { id: firstNode.id, type: "select", selected: true },
    ]);
    useWorkflowStore.getState().onEdgesChange([
      { id: firstEdge.id, type: "select", selected: true },
    ]);

    expect(useWorkflowStore.getState().saveState).toBe("idle");
    expect(useWorkflowStore.getState().undoStack).toHaveLength(0);
    expect(useWorkflowStore.getState().rev).toBe(1);
  });
});

describe("workflow builder execution", () => {
  beforeEach(() => {
    fresh("acme");
  });

  it("plans a connected workflow run from trigger downstream", () => {
    const trigger = createNode("trigger", { x: 0, y: 0 }, "Manual trigger");
    const agent = createNode("agent", { x: 260, y: 0 }, "Score lead");
    const end = createNode("end", { x: 520, y: 0 }, "Done");

    const result = planWorkflowRun(
      [trigger, agent, end],
      [
        { id: edgeId(trigger.id, agent.id), source: trigger.id, target: agent.id },
        { id: edgeId(agent.id, end.id), source: agent.id, target: end.id },
      ],
    );

    expect(result.ok).toBe(true);
    expect(result.orderedNodeIds).toEqual([trigger.id, agent.id, end.id]);
    expect(result.log.map((entry) => entry.label)).toEqual(["Manual trigger", "Score lead", "Done"]);
  });

  it("executes a workflow and records per-node statuses and logs", async () => {
    useWorkflowStore.getState().init("acme");
    const trigger = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "trigger");
    const end = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "end");
    const agent = createNode("agent", { x: 260, y: 250 }, "Score lead");

    expect(trigger).toBeDefined();
    expect(end).toBeDefined();
    useWorkflowStore.getState().addNode(agent, {
      insertOnEdge: { id: edgeId(trigger?.id ?? "", end?.id ?? ""), source: trigger?.id ?? "", target: end?.id ?? "" },
    });

    const result = await useWorkflowStore.getState().executeWorkflow();
    const state = useWorkflowStore.getState();

    expect(result.ok).toBe(true);
    expect(state.runState).toBe("success");
    expect(state.runLog).toHaveLength(3);
    expect(state.runHistory).toHaveLength(1);
    expect(state.runHistory[0]).toMatchObject({ status: "success", nodeCount: 3 });
    expect(Object.values(state.nodeExecutions).map((entry) => entry.status)).toEqual(["success", "success", "success"]);
    expect(state.runLog.map((entry) => entry.label)).toContain("Score lead");

    const raw = window.localStorage.getItem(workflowDraftStorageKey("acme"));
    const saved = JSON.parse(raw ?? "{}") as { runHistory?: unknown[] };
    expect(saved.runHistory).toHaveLength(1);

    useWorkflowStore.getState().init("acme");
    expect(useWorkflowStore.getState().runHistory).toHaveLength(1);
  });

  it("fails execution when no trigger exists", async () => {
    useWorkflowStore.getState().init("acme");
    useWorkflowStore.setState((state) => ({
      nodes: state.nodes.filter((node) => node.data?.nodeType !== "trigger"),
      edges: [],
    }));

    const result = await useWorkflowStore.getState().executeWorkflow();

    expect(result.ok).toBe(false);
    expect(useWorkflowStore.getState().runState).toBe("error");
    expect(useWorkflowStore.getState().runLog[0]?.message).toMatch(/trigger/i);
    expect(useWorkflowStore.getState().runHistory[0]?.status).toBe("error");
    expect(useWorkflowStore.getState().showExecutions).toBe(true);
  });
});

describe("workflow builder JSON import/export", () => {
  beforeEach(() => {
    fresh("acme");
  });

  it("exports and imports a workflow snapshot", () => {
    useWorkflowStore.getState().init("acme");
    const trigger = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "trigger");
    expect(trigger).toBeDefined();

    useWorkflowStore.getState().setWorkflowName("Exported workflow");
    useWorkflowStore.getState().setActive(true);
    useWorkflowStore.getState().addNode(
      createNode("agent", { x: 280, y: 250 }, "Imported agent"),
      { connectFrom: trigger?.id },
    );

    const exported = useWorkflowStore.getState().exportWorkflowSnapshot();
    useWorkflowStore.getState().resetDraft("acme");
    const result = useWorkflowStore.getState().importWorkflowSnapshot(JSON.stringify(exported));

    expect(result.ok).toBe(true);
    expect(useWorkflowStore.getState().workflowName).toBe("Exported workflow");
    expect(useWorkflowStore.getState().active).toBe(true);
    expect(useWorkflowStore.getState().nodes).toHaveLength(3);
    expect(useWorkflowStore.getState().saveState).toBe("dirty");
  });

  it("parses n8n-style connections by node label", () => {
    const trigger = createNode("trigger", { x: 0, y: 0 }, "Manual trigger");
    const agent = createNode("agent", { x: 240, y: 0 }, "AI Agent");

    const result = parseWorkflowSnapshot({
      name: "n8n-ish import",
      nodes: [trigger, agent],
      connections: {
        "Manual trigger": {
          main: [[{ node: "AI Agent", type: "main", index: 0 }]],
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.edges).toEqual([
        expect.objectContaining({ source: trigger.id, target: agent.id }),
      ]);
    }
  });

  it("rejects invalid workflow JSON", () => {
    const result = useWorkflowStore.getState().importWorkflowSnapshot("{not-json");

    expect(result.ok).toBe(false);
    expect(useWorkflowStore.getState().workflowName).toBe("Untitled workflow");
  });
});

describe("workflow builder canvas clipboard", () => {
  beforeEach(() => {
    fresh("acme");
  });

  it("copies and pastes the selected node with a new id and offset position", () => {
    useWorkflowStore.getState().init("acme");
    const trigger = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "trigger");
    expect(trigger).toBeDefined();

    useWorkflowStore.getState().selectNode(trigger?.id ?? null);
    expect(useWorkflowStore.getState().copySelectedNode()).toBe(true);
    const pasted = useWorkflowStore.getState().pasteClipboardNode();

    expect(pasted).toBeTruthy();
    expect(pasted?.id).not.toBe(trigger?.id);
    expect(pasted?.position).toEqual({
      x: (trigger?.position.x ?? 0) + 48,
      y: (trigger?.position.y ?? 0) + 48,
    });
    expect(useWorkflowStore.getState().nodes).toHaveLength(3);
    expect(useWorkflowStore.getState().selectedNodeId).toBe(pasted?.id);
    expect(useWorkflowStore.getState().saveState).toBe("dirty");
  });

  it("duplicates the selected node", () => {
    useWorkflowStore.getState().init("acme");
    const end = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "end");
    useWorkflowStore.getState().selectNode(end?.id ?? null);

    const duplicated = useWorkflowStore.getState().duplicateSelectedNode();

    expect(duplicated).toBeTruthy();
    expect(useWorkflowStore.getState().nodes).toHaveLength(3);
    expect(useWorkflowStore.getState().selectedNodeId).toBe(duplicated?.id);
  });

  it("deletes the selected node and connected edges", () => {
    useWorkflowStore.getState().init("acme");
    const trigger = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "trigger");
    useWorkflowStore.getState().selectNode(trigger?.id ?? null);

    useWorkflowStore.getState().deleteSelected();

    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });
});

describe("workflow builder undo and redo", () => {
  beforeEach(() => {
    fresh("acme");
  });

  it("undoes and redoes graph mutations", () => {
    useWorkflowStore.getState().init("acme");
    const initialNodeCount = useWorkflowStore.getState().nodes.length;
    const trigger = useWorkflowStore
      .getState()
      .nodes.find((node) => node.data?.nodeType === "trigger");

    useWorkflowStore.getState().addNode(
      createNode("agent", { x: 260, y: 250 }, "Undo agent"),
      { connectFrom: trigger?.id },
    );
    expect(useWorkflowStore.getState().nodes).toHaveLength(initialNodeCount + 1);
    expect(useWorkflowStore.getState().undoStack).toHaveLength(1);

    expect(useWorkflowStore.getState().undo()).toBe(true);
    expect(useWorkflowStore.getState().nodes).toHaveLength(initialNodeCount);
    expect(useWorkflowStore.getState().redoStack).toHaveLength(1);

    expect(useWorkflowStore.getState().redo()).toBe(true);
    expect(useWorkflowStore.getState().nodes).toHaveLength(initialNodeCount + 1);
  });

  it("undoes workflow name and active changes", () => {
    useWorkflowStore.getState().init("acme");

    useWorkflowStore.getState().setWorkflowName("Renamed");
    useWorkflowStore.getState().setActive(true);

    expect(useWorkflowStore.getState().active).toBe(true);
    expect(useWorkflowStore.getState().undo()).toBe(true);
    expect(useWorkflowStore.getState().active).toBe(false);
    expect(useWorkflowStore.getState().workflowName).toBe("Renamed");
    expect(useWorkflowStore.getState().undo()).toBe(true);
    expect(useWorkflowStore.getState().workflowName).toBe("Untitled workflow");
  });
});
