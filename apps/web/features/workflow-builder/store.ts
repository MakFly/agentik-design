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
import { createInitialNodes, edgeId, nodeId } from "./utils";
import type { NodeType } from "@/types/domain";

export type SaveState = "idle" | "dirty" | "saving" | "saved";
export type RunState = "idle" | "running" | "success" | "error";
export type NodeExecutionStatus = "waiting" | "running" | "success" | "error";
const WORKFLOW_STORAGE_VERSION = 1;

type AddNodeOptions = {
  connectFrom?: string;
  insertOnEdge?: { id: string; source: string; target: string };
  select?: boolean;
};

export type PersistedWorkflowDraft = {
  version: typeof WORKFLOW_STORAGE_VERSION;
  workflowName: string;
  active: boolean;
  nodes: Node[];
  edges: Edge[];
  runHistory: WorkflowRunHistoryEntry[];
  savedAt: string;
};

export type NodeExecution = {
  status: NodeExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  output?: unknown;
};

export type RunLogEntry = {
  id: string;
  nodeId: string;
  label: string;
  status: Exclude<NodeExecutionStatus, "waiting">;
  message: string;
  timestamp: string;
};

export type WorkflowRunResult = {
  ok: boolean;
  orderedNodeIds: string[];
  log: RunLogEntry[];
  error?: string;
};

export type WorkflowRunHistoryEntry = {
  id: string;
  status: "success" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeCount: number;
  log: RunLogEntry[];
  error?: string;
};

const MAX_RUN_HISTORY = 20;
const MAX_UNDO_HISTORY = 50;

export type WorkflowSnapshot = {
  name: string;
  active: boolean;
  nodes: Node[];
  edges: Edge[];
};

export type WorkflowImportResult =
  | { ok: true; snapshot: WorkflowSnapshot }
  | { ok: false; error: string };

type UndoSnapshot = {
  workflowName: string;
  active: boolean;
  nodes: Node[];
  edges: Edge[];
};

interface WorkflowBuilderState {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node, options?: AddNodeOptions) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  deleteSelected: () => void;

  selectedNodeId: string | null;
  clipboardNode: Node | null;
  paletteOpen: boolean;
  selectNode: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  copySelectedNode: () => boolean;
  pasteClipboardNode: () => Node | null;
  duplicateSelectedNode: () => Node | null;

  workflowName: string;
  setWorkflowName: (name: string) => void;
  active: boolean;
  setActive: (active: boolean) => void;

  saveState: SaveState;
  setSaveState: (s: SaveState) => void;
  runState: RunState;
  setRunState: (s: RunState) => void;
  nodeExecutions: Record<string, NodeExecution>;
  runLog: RunLogEntry[];
  lastRunAt: string | null;
  runHistory: WorkflowRunHistoryEntry[];
  showExecutions: boolean;
  setShowExecutions: (show: boolean) => void;
  executeWorkflow: () => Promise<WorkflowRunResult>;
  undoStack: UndoSnapshot[];
  redoStack: UndoSnapshot[];
  undo: () => boolean;
  redo: () => boolean;
  rev: number;
  currentTeam: string | null;

  init: (team: string) => void;
  persistDraft: (team: string) => boolean;
  resetDraft: (team: string) => void;
  exportWorkflowSnapshot: () => WorkflowSnapshot;
  importWorkflowSnapshot: (input: unknown) => WorkflowImportResult;
}

function dirty(s: { rev: number }): { rev: number; saveState: SaveState } {
  return { rev: s.rev + 1, saveState: "dirty" };
}

function cloneGraphSnapshot(s: Pick<WorkflowBuilderState, "workflowName" | "active" | "nodes" | "edges">): UndoSnapshot {
  const nodes = typeof structuredClone === "function"
    ? structuredClone(s.nodes)
    : JSON.parse(JSON.stringify(s.nodes));
  const edges = typeof structuredClone === "function"
    ? structuredClone(s.edges)
    : JSON.parse(JSON.stringify(s.edges));

  return {
    workflowName: s.workflowName,
    active: s.active,
    nodes,
    edges,
  };
}

function withUndo(s: WorkflowBuilderState): Pick<WorkflowBuilderState, "undoStack" | "redoStack"> {
  return {
    undoStack: [...s.undoStack, cloneGraphSnapshot(s)].slice(-MAX_UNDO_HISTORY),
    redoStack: [],
  };
}

function isPersistentNodeChange(change: NodeChange): boolean {
  if (change.type === "select" || change.type === "dimensions") return false;
  if (change.type === "position") return change.dragging !== true;
  return true;
}

function isPersistentEdgeChange(change: EdgeChange): boolean {
  return change.type !== "select";
}

function restoreUndoSnapshot(snapshot: UndoSnapshot): Pick<
  WorkflowBuilderState,
  | "workflowName"
  | "active"
  | "nodes"
  | "edges"
  | "selectedNodeId"
  | "nodeExecutions"
  | "runLog"
  | "lastRunAt"
  | "showExecutions"
> {
  return {
    workflowName: snapshot.workflowName,
    active: snapshot.active,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    selectedNodeId: null,
    nodeExecutions: {},
    runLog: [],
    lastRunAt: null,
    showExecutions: false,
  };
}

function cloneNodeForPaste(node: Node, offset = 48): Node {
  const data = typeof structuredClone === "function"
    ? structuredClone(node.data)
    : JSON.parse(JSON.stringify(node.data));

  return {
    ...node,
    id: nodeId(),
    selected: false,
    dragging: false,
    position: {
      x: node.position.x + offset,
      y: node.position.y + offset,
    },
    data,
  };
}

function nodeData(node: Node): { nodeType?: NodeType; label?: string; config?: Record<string, unknown> } {
  return node.data as { nodeType?: NodeType; label?: string; config?: Record<string, unknown> };
}

function runMessage(type: NodeType | undefined, label: string): string {
  switch (type) {
    case "trigger":
      return `${label} received a manual test event`;
    case "agent":
      return `${label} prepared an AI task`;
    case "tool":
      return `${label} resolved tool arguments`;
    case "api":
      return `${label} prepared an HTTP request`;
    case "decision":
      return `${label} evaluated its default branch`;
    case "approval":
      return `${label} created a pending approval`;
    case "code":
      return `${label} executed JavaScript`;
    case "loop":
      return `${label} iterated over its collection`;
    case "subflow":
      return `${label} prepared a sub-workflow call`;
    case "end":
      return `${label} completed the workflow`;
    default:
      return `${label} executed`;
  }
}

export function planWorkflowRun(nodes: Node[], edges: Edge[]): WorkflowRunResult {
  const triggers = nodes.filter((node) => nodeData(node).nodeType === "trigger");
  if (triggers.length === 0) {
    return { ok: false, orderedNodeIds: [], log: [], error: "Add a trigger before executing the workflow." };
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const orderedNodeIds: string[] = [];
  const queued = triggers.map((node) => node.id);
  const visited = new Set<string>();

  while (queued.length > 0) {
    const id = queued.shift();
    if (!id || visited.has(id) || !nodesById.has(id)) continue;

    visited.add(id);
    orderedNodeIds.push(id);

    for (const next of outgoing.get(id) ?? []) {
      if (!visited.has(next)) queued.push(next);
    }
  }

  if (orderedNodeIds.length === 0) {
    return { ok: false, orderedNodeIds: [], log: [], error: "No executable nodes were found." };
  }

  return {
    ok: true,
    orderedNodeIds,
    log: orderedNodeIds.map((nodeId, index) => {
      const node = nodesById.get(nodeId);
      const data = node ? nodeData(node) : {};
      const label = data.label ?? `Node ${index + 1}`;
      const timestamp = new Date(Date.now() + index).toISOString();

      return {
        id: `run_${nodeId}_${index}`,
        nodeId,
        label,
        status: "success",
        message: runMessage(data.nodeType, label),
        timestamp,
      };
    }),
  };
}

function initialExecutions(nodes: Node[]): Record<string, NodeExecution> {
  return Object.fromEntries(nodes.map((node) => [node.id, { status: "waiting" as const }]));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prependHistory(
  history: WorkflowRunHistoryEntry[],
  entry: WorkflowRunHistoryEntry,
): WorkflowRunHistoryEntry[] {
  return [entry, ...history].slice(0, MAX_RUN_HISTORY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkflowNode(value: unknown): value is Node {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (value.type !== "workflow") return false;
  if (!isRecord(value.position)) return false;
  if (typeof value.position.x !== "number" || typeof value.position.y !== "number") return false;
  if (!isRecord(value.data)) return false;
  return typeof value.data.nodeType === "string" && typeof value.data.label === "string";
}

function isWorkflowEdge(value: unknown): value is Edge {
  if (!isRecord(value)) return false;
  return typeof value.source === "string" && typeof value.target === "string";
}

function nodeLabel(node: Node): string {
  return nodeData(node).label ?? node.id;
}

function edgesFromN8nConnections(nodes: Node[], connections: unknown): Edge[] {
  if (!isRecord(connections)) return [];

  const byName = new Map<string, Node>();
  for (const node of nodes) {
    byName.set(node.id, node);
    byName.set(nodeLabel(node), node);
  }

  const edges: Edge[] = [];
  for (const [sourceName, sourceConnections] of Object.entries(connections)) {
    const source = byName.get(sourceName);
    if (!source || !isRecord(sourceConnections)) continue;
    const main = sourceConnections.main;
    if (!Array.isArray(main)) continue;

    for (const group of main) {
      if (!Array.isArray(group)) continue;
      for (const targetConnection of group) {
        if (!isRecord(targetConnection) || typeof targetConnection.node !== "string") continue;
        const target = byName.get(targetConnection.node);
        if (!target) continue;
        edges.push({
          id: edgeId(source.id, target.id),
          source: source.id,
          target: target.id,
          type: "workflow",
        });
      }
    }
  }

  return edges;
}

export function parseWorkflowSnapshot(input: unknown): WorkflowImportResult {
  let parsed = input;

  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, error: "Clipboard does not contain valid workflow JSON." };
    }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Workflow JSON must be an object." };
  }

  if (!Array.isArray(parsed.nodes)) {
    return { ok: false, error: "Workflow JSON must include a nodes array." };
  }

  const nodes = parsed.nodes.filter(isWorkflowNode);
  if (nodes.length === 0) {
    return { ok: false, error: "Workflow JSON does not contain compatible nodes." };
  }

  const edges = Array.isArray(parsed.edges)
    ? parsed.edges.filter(isWorkflowEdge).map((edge) => ({ ...edge, type: "workflow" }))
    : edgesFromN8nConnections(nodes, parsed.connections);

  const name =
    typeof parsed.name === "string"
      ? parsed.name
      : typeof parsed.workflowName === "string"
        ? parsed.workflowName
        : "Imported workflow";

  return {
    ok: true,
    snapshot: {
      name,
      active: typeof parsed.active === "boolean" ? parsed.active : false,
      nodes,
      edges,
    },
  };
}

export function workflowDraftStorageKey(team: string): string {
  return `agentik:workflow-builder:${team}:draft`;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readDraft(team: string): PersistedWorkflowDraft | null {
  if (!canUseLocalStorage()) return null;

  try {
    const raw = window.localStorage.getItem(workflowDraftStorageKey(team));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedWorkflowDraft>;
    if (
      parsed.version !== WORKFLOW_STORAGE_VERSION ||
      typeof parsed.workflowName !== "string" ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.edges)
    ) {
      return null;
    }

    return {
      version: WORKFLOW_STORAGE_VERSION,
      workflowName: parsed.workflowName,
      active: typeof parsed.active === "boolean" ? parsed.active : false,
      nodes: parsed.nodes,
      edges: parsed.edges,
      runHistory: Array.isArray(parsed.runHistory) ? parsed.runHistory : [],
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeDraft(team: string, draft: PersistedWorkflowDraft): boolean {
  if (!canUseLocalStorage()) return false;

  try {
    window.localStorage.setItem(workflowDraftStorageKey(team), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export const useWorkflowStore = create<WorkflowBuilderState>((set, get) => {
  const initial = createInitialNodes();
  return {
    nodes: initial.nodes,
    edges: initial.edges,
    selectedNodeId: null,
    clipboardNode: null,
    paletteOpen: true,
    workflowName: "Untitled workflow",
    active: false,
    saveState: "idle",
    runState: "idle",
    nodeExecutions: {},
    runLog: [],
    lastRunAt: null,
    runHistory: [],
    showExecutions: false,
    undoStack: [],
    redoStack: [],
    currentTeam: null,
    rev: 0,

    init: (team) => {
      const saved = readDraft(team);
      if (saved) {
        set({
          nodes: saved.nodes,
          edges: saved.edges,
          selectedNodeId: null,
          clipboardNode: null,
          paletteOpen: true,
          saveState: "saved",
          runState: "idle",
          nodeExecutions: {},
          runLog: [],
          lastRunAt: null,
          runHistory: saved.runHistory,
          showExecutions: false,
          undoStack: [],
          redoStack: [],
          currentTeam: team,
          rev: 0,
          workflowName: saved.workflowName,
          active: saved.active,
        });
        return;
      }

      const initialWorkflow = createInitialNodes();
      set((s) => ({
        nodes: initialWorkflow.nodes,
        edges: initialWorkflow.edges,
        selectedNodeId: null,
        clipboardNode: null,
        paletteOpen: true,
        saveState: "idle",
        runState: "idle",
        nodeExecutions: {},
        runLog: [],
        lastRunAt: null,
        runHistory: [],
        showExecutions: false,
        undoStack: [],
        redoStack: [],
        currentTeam: team,
        rev: s.rev + 1,
        workflowName: "Untitled workflow",
        active: false,
      }));
    },

    onNodesChange: (changes) =>
      set((s) => {
        const persistent = changes.some(isPersistentNodeChange);

        return {
          nodes: applyNodeChanges(changes, s.nodes),
          ...(persistent ? withUndo(s) : {}),
          ...(persistent ? dirty(s) : {}),
        };
      }),

    onEdgesChange: (changes) =>
      set((s) => {
        const persistent = changes.some(isPersistentEdgeChange);

        return {
          edges: applyEdgeChanges(changes, s.edges),
          ...(persistent ? withUndo(s) : {}),
          ...(persistent ? dirty(s) : {}),
        };
      }),

    onConnect: (connection) =>
      set((s) => ({
        edges: addEdge(
          {
            ...connection,
            id: connection.source && connection.target
              ? edgeId(connection.source, connection.target)
              : undefined,
            type: "workflow",
          },
          s.edges,
        ),
        ...withUndo(s),
        ...dirty(s),
      })),

    addNode: (node, options) =>
      set((s) => {
        let nextEdges = s.edges;

        if (options?.insertOnEdge) {
          const { id, source, target } = options.insertOnEdge;
          nextEdges = [
            ...s.edges.filter((edge) => edge.id !== id),
            { id: edgeId(source, node.id), source, target: node.id, type: "workflow" },
            { id: edgeId(node.id, target), source: node.id, target, type: "workflow" },
          ];
        } else if (options?.connectFrom) {
          nextEdges = addEdge(
            { id: edgeId(options.connectFrom, node.id), source: options.connectFrom, target: node.id, type: "workflow" },
            s.edges,
          );
        }

        return {
          nodes: [...s.nodes, node],
          edges: nextEdges,
          selectedNodeId: options?.select ? node.id : s.selectedNodeId,
          paletteOpen: options?.select ? false : s.paletteOpen,
          nodeExecutions: {},
          runLog: [],
          lastRunAt: null,
          showExecutions: false,
          ...withUndo(s),
          ...dirty(s),
        };
      }),

    updateNodeData: (id, data) =>
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
        ...withUndo(s),
        ...dirty(s),
      })),

    selectNode: (id) => set({ selectedNodeId: id }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    copySelectedNode: () => {
      const { selectedNodeId, nodes } = get();
      const node = nodes.find((n) => n.id === selectedNodeId);
      if (!node) return false;
      set({ clipboardNode: node });
      return true;
    },
    pasteClipboardNode: () => {
      const { clipboardNode } = get();
      if (!clipboardNode) return null;
      const pasted = cloneNodeForPaste(clipboardNode);
      set((s) => ({
        nodes: [...s.nodes, pasted],
        selectedNodeId: pasted.id,
        nodeExecutions: {},
        runLog: [],
        lastRunAt: null,
        showExecutions: false,
        ...withUndo(s),
        ...dirty(s),
      }));
      return pasted;
    },
    duplicateSelectedNode: () => {
      const copied = get().copySelectedNode();
      if (!copied) return null;
      return get().pasteClipboardNode();
    },
    deleteSelected: () => {
      const { selectedNodeId, nodes, edges } = get();
      if (!selectedNodeId) return;
      set((s) => ({
        nodes: nodes.filter((n) => n.id !== selectedNodeId),
        edges: edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
        selectedNodeId: null,
        nodeExecutions: {},
        runLog: [],
        lastRunAt: null,
        showExecutions: false,
        ...withUndo(s),
        ...dirty(s),
      }));
    },
    setWorkflowName: (workflowName) => set((s) => ({ workflowName, ...withUndo(s), ...dirty(s) })),
    setActive: (active) => set((s) => ({ active, ...withUndo(s), ...dirty(s) })),
    setSaveState: (saveState) => set({ saveState }),
    setRunState: (runState) => set({ runState }),
    setShowExecutions: (showExecutions) => set({ showExecutions }),
    undo: () => {
      const { undoStack } = get();
      const previous = undoStack.at(-1);
      if (!previous) return false;

      set((s) => ({
        ...restoreUndoSnapshot(previous),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, cloneGraphSnapshot(s)].slice(-MAX_UNDO_HISTORY),
        ...dirty(s),
      }));
      return true;
    },
    redo: () => {
      const { redoStack } = get();
      const next = redoStack.at(-1);
      if (!next) return false;

      set((s) => ({
        ...restoreUndoSnapshot(next),
        undoStack: [...s.undoStack, cloneGraphSnapshot(s)].slice(-MAX_UNDO_HISTORY),
        redoStack: s.redoStack.slice(0, -1),
        ...dirty(s),
      }));
      return true;
    },
    executeWorkflow: async () => {
      const { nodes, edges } = get();
      const planned = planWorkflowRun(nodes, edges);
      const runId = `exec_${Date.now()}`;
      const startedAt = new Date().toISOString();

      if (!planned.ok) {
        const timestamp = new Date().toISOString();
        const errorLog: RunLogEntry[] = [{
          id: `run_error_${Date.now()}`,
          nodeId: "",
          label: "Workflow",
          status: "error",
          message: planned.error ?? "Workflow execution failed.",
          timestamp,
        }];
        const historyEntry: WorkflowRunHistoryEntry = {
          id: runId,
          status: "error",
          startedAt,
          finishedAt: timestamp,
          durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(startedAt)),
          nodeCount: 0,
          log: errorLog,
          error: planned.error ?? "Workflow execution failed.",
        };

        set((s) => ({
          runState: "error",
          nodeExecutions: {},
          runLog: errorLog,
          lastRunAt: timestamp,
          runHistory: prependHistory(s.runHistory, historyEntry),
          showExecutions: true,
        }));
        const team = get().currentTeam;
        if (team) get().persistDraft(team);
        return { ...planned, log: errorLog };
      }

      set({
        runState: "running",
        nodeExecutions: initialExecutions(nodes),
        runLog: [],
        lastRunAt: startedAt,
      });

      const completedLog: RunLogEntry[] = [];
      for (const entry of planned.log) {
        const started = new Date().toISOString();
        set((s) => ({
          nodeExecutions: {
            ...s.nodeExecutions,
            [entry.nodeId]: { status: "running", startedAt: started, message: entry.message },
          },
        }));

        await sleep(120);

        completedLog.push(entry);
        set((s) => ({
          nodeExecutions: {
            ...s.nodeExecutions,
            [entry.nodeId]: {
              status: "success",
              startedAt: s.nodeExecutions[entry.nodeId]?.startedAt ?? started,
              finishedAt: new Date().toISOString(),
              message: entry.message,
              output: { ok: true, nodeId: entry.nodeId, label: entry.label },
            },
          },
          runLog: completedLog,
        }));
      }

      const finishedAt = new Date().toISOString();
      const historyEntry: WorkflowRunHistoryEntry = {
        id: runId,
        status: "success",
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        nodeCount: planned.orderedNodeIds.length,
        log: planned.log,
      };
      set((s) => ({
        runState: "success",
        lastRunAt: finishedAt,
        runHistory: prependHistory(s.runHistory, historyEntry),
      }));
      const team = get().currentTeam;
      if (team) get().persistDraft(team);
      return planned;
    },
    persistDraft: (team) => {
      const { workflowName, active, nodes, edges, runHistory } = get();
      return writeDraft(team, {
        version: WORKFLOW_STORAGE_VERSION,
        workflowName,
        active,
        nodes,
        edges,
        runHistory,
        savedAt: new Date().toISOString(),
      });
    },
    resetDraft: (team) => {
      if (canUseLocalStorage()) {
        window.localStorage.removeItem(workflowDraftStorageKey(team));
      }
      const initialWorkflow = createInitialNodes();
      set({
        nodes: initialWorkflow.nodes,
        edges: initialWorkflow.edges,
        selectedNodeId: null,
        clipboardNode: null,
        paletteOpen: true,
        saveState: "idle",
        runState: "idle",
        nodeExecutions: {},
        runLog: [],
        lastRunAt: null,
        runHistory: [],
        showExecutions: false,
        currentTeam: team,
        rev: 0,
        workflowName: "Untitled workflow",
        active: false,
      });
    },
    exportWorkflowSnapshot: () => {
      const { workflowName, active, nodes, edges } = get();
      return {
        name: workflowName,
        active,
        nodes,
        edges,
      };
    },
    importWorkflowSnapshot: (input) => {
      const result = parseWorkflowSnapshot(input);
      if (!result.ok) return result;

      set((s) => ({
        nodes: result.snapshot.nodes,
        edges: result.snapshot.edges,
        workflowName: result.snapshot.name,
        active: result.snapshot.active,
        selectedNodeId: null,
        clipboardNode: null,
        paletteOpen: false,
        saveState: "dirty",
        runState: "idle",
        nodeExecutions: {},
        runLog: [],
        lastRunAt: null,
        runHistory: [],
        showExecutions: false,
        ...withUndo(s),
        rev: s.rev + 1,
      }));

      return result;
    },
  };
});
