import { create } from "zustand";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import { createInitialNodes } from "./utils";

export type SaveState = "idle" | "dirty" | "saving" | "saved";

interface WorkflowBuilderState {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  deleteSelected: () => void;

  selectedNodeId: string | null;
  paletteOpen: boolean;
  selectNode: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;

  workflowName: string;
  setWorkflowName: (name: string) => void;

  saveState: SaveState;
  setSaveState: (s: SaveState) => void;
  rev: number;

  init: () => void;
}

function dirty(s: { rev: number }): { rev: number; saveState: SaveState } {
  return { rev: s.rev + 1, saveState: "dirty" };
}

export const useWorkflowStore = create<WorkflowBuilderState>((set, get) => {
  const initial = createInitialNodes();
  return {
    nodes: initial.nodes,
    edges: initial.edges,
    selectedNodeId: null,
    paletteOpen: true,
    workflowName: "Untitled workflow",
    saveState: "idle",
    rev: 0,

    init: () => {
      const i = createInitialNodes();
      set({ nodes: i.nodes, edges: i.edges, selectedNodeId: null, saveState: "idle", rev: 0, workflowName: "Untitled workflow" });
    },

    onNodesChange: (changes) =>
      set((s) => ({
        nodes: applyNodeChanges(changes, s.nodes),
        ...dirty(s),
      })),

    onEdgesChange: (changes) =>
      set((s) => ({
        edges: applyEdgeChanges(changes, s.edges),
        ...dirty(s),
      })),

    onConnect: (connection) =>
      set((s) => ({
        edges: addEdge({ ...connection, type: "workflow" }, s.edges),
        ...dirty(s),
      })),

    addNode: (node) =>
      set((s) => ({
        nodes: [...s.nodes, node],
        ...dirty(s),
      })),

    updateNodeData: (id, data) =>
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
        ...dirty(s),
      })),

    deleteSelected: () => {
      const { selectedNodeId, nodes, edges } = get();
      if (!selectedNodeId) return;
      set((s) => ({
        nodes: nodes.filter((n) => n.id !== selectedNodeId),
        edges: edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
        selectedNodeId: null,
        ...dirty(s),
      }));
    },

    selectNode: (id) => set({ selectedNodeId: id }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setWorkflowName: (workflowName) => set((s) => ({ workflowName, ...dirty(s) })),
    setSaveState: (saveState) => set({ saveState }),
  };
});
