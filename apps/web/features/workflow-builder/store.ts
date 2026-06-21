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
import type { RunDetail } from "@agentik/workflow-schema";
import { toGraph } from "./serialize";
import { createWorkflow, saveVersion, startRun, subscribeRun } from "./api";

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
  workflowId: string | null;
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
  input?: unknown;
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
  /** Rename a decision branch and keep its outgoing edge handles in sync. */
  renameDecisionBranch: (nodeId: string, index: number, newLabel: string) => void;
  /** Remove a decision branch and drop the edges leaving its handle. */
  removeDecisionBranch: (nodeId: string, index: number) => void;
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
  workflowId: string | null;
  setWorkflowId: (id: string | null) => void;

  init: (team: string) => void;
  /** Hydrate the builder from a persisted engine workflow (edit route). */
  initFromEngine: (team: string, id: string, snapshot: WorkflowSnapshot) => void;
  /** Create-or-version the workflow on the engine. Returns the workflow id. */
  saveToEngine: (team: string) => Promise<string | null>;
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

/** Map engine run steps onto the canvas per-node execution overlay. */
function stepsToExecutions(run: RunDetail): Record<string, NodeExecution> {
  const map: Record<string, NodeExecution> = {};
  for (const s of run.steps) {
    const status: NodeExecutionStatus =
      s.status === "succeeded"
        ? "success"
        : s.status === "failed"
          ? "error"
          : s.status === "running" || s.status === "retrying"
            ? "running"
            : "waiting";
    map[s.nodeId] = {
      status,
      startedAt: s.startedAt,
      finishedAt: s.endedAt ?? undefined,
      message: s.error ?? undefined,
      input: s.input ?? undefined,
      output: s.output ?? undefined,
    };
  }
  return map;
}

function stepsToLog(run: RunDetail): RunLogEntry[] {
  return run.steps
    .filter((s) => s.status === "succeeded" || s.status === "failed")
    .map((s) => ({
      id: s.id,
      nodeId: s.nodeId,
      label: s.label,
      status: s.status === "succeeded" ? "success" : "error",
      message: s.error ?? `${s.label} ${s.status}`,
      timestamp: s.endedAt ?? s.startedAt,
    }));
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
      workflowId: typeof parsed.workflowId === "string" ? parsed.workflowId : null,
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
    workflowId: null,
    rev: 0,

    setWorkflowId: (id) => set({ workflowId: id }),

    init: (team) => {
      const saved = readDraft(team);
      // Only restore genuinely-unsaved NEW work. A draft carrying a workflowId
      // belongs to a persisted workflow (edited via /[id]); restoring it on
      // /new would silently bind "New workflow" to that existing workflow.
      if (saved && saved.workflowId === null) {
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
          workflowId: saved.workflowId,
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
        workflowId: null,
        rev: s.rev + 1,
        workflowName: "Untitled workflow",
        active: false,
      }));
    },

    initFromEngine: (team, id, snapshot) => {
      set({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        workflowName: snapshot.name,
        active: snapshot.active,
        workflowId: id,
        currentTeam: team,
        selectedNodeId: null,
        clipboardNode: null,
        paletteOpen: true,
        saveState: "saved",
        runState: "idle",
        nodeExecutions: {},
        runLog: [],
        lastRunAt: null,
        runHistory: [],
        showExecutions: false,
        undoStack: [],
        redoStack: [],
        rev: 0,
      });
    },

    saveToEngine: async (team) => {
      const { workflowId, workflowName, active, nodes, edges } = get();
      const graph = toGraph(nodes, edges);
      set({ saveState: "saving" });
      try {
        let id = workflowId;
        if (!id) {
          const created = await createWorkflow(team, workflowName || "Untitled workflow");
          id = created.id;
          set({ workflowId: id });
        }
        await saveVersion(team, id, { graph, name: workflowName, active });
        set({ saveState: "saved" });
        get().persistDraft(team);
        return id;
      } catch {
        set({ saveState: "dirty" });
        return null;
      }
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

    renameDecisionBranch: (nodeId, index, newLabel) =>
      set((s) => {
        const node = s.nodes.find((n) => n.id === nodeId);
        const config = (node?.data as { config?: Record<string, unknown> } | undefined)?.config ?? {};
        const branches = (config.branches as Array<{ label: string; expression: string }>) ?? [];
        const oldLabel = branches[index]?.label;
        const nextBranches = branches.map((b, j) => (j === index ? { ...b, label: newLabel } : b));
        return {
          nodes: s.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, config: { ...config, branches: nextBranches } } } : n,
          ),
          edges:
            oldLabel === undefined || oldLabel === newLabel
              ? s.edges
              : s.edges.map((e) =>
                  e.source === nodeId && e.sourceHandle === oldLabel ? { ...e, sourceHandle: newLabel } : e,
                ),
          ...withUndo(s),
          ...dirty(s),
        };
      }),

    removeDecisionBranch: (nodeId, index) =>
      set((s) => {
        const node = s.nodes.find((n) => n.id === nodeId);
        const config = (node?.data as { config?: Record<string, unknown> } | undefined)?.config ?? {};
        const branches = (config.branches as Array<{ label: string; expression: string }>) ?? [];
        const removed = branches[index]?.label;
        const nextBranches = branches.filter((_, j) => j !== index);
        return {
          nodes: s.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, config: { ...config, branches: nextBranches } } } : n,
          ),
          edges: s.edges.filter((e) => !(e.source === nodeId && e.sourceHandle === removed)),
          ...withUndo(s),
          ...dirty(s),
        };
      }),

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
      const startedAt = new Date().toISOString();
      const team = get().currentTeam;

      const failRun = (message: string): WorkflowRunResult => {
        const ts = new Date().toISOString();
        const errorLog: RunLogEntry[] = [
          { id: `run_error_${ts}`, nodeId: "", label: "Workflow", status: "error", message, timestamp: ts },
        ];
        set((s) => ({
          runState: "error",
          nodeExecutions: {},
          runLog: errorLog,
          lastRunAt: ts,
          runHistory: prependHistory(s.runHistory, {
            id: `exec_${ts}`,
            status: "error",
            startedAt,
            finishedAt: ts,
            durationMs: 0,
            nodeCount: 0,
            log: errorLog,
            error: message,
          }),
          showExecutions: true,
        }));
        if (team) get().persistDraft(team);
        return { ok: false, orderedNodeIds: [], log: errorLog, error: message };
      };

      if (!team) return failRun("No active team for this workflow.");

      // Show the loading state immediately on click — it covers the save +
      // enqueue latency, before the first run-status event arrives.
      set({
        runState: "running",
        nodeExecutions: initialExecutions(get().nodes),
        runLog: [],
        lastRunAt: startedAt,
        showExecutions: true,
      });

      // A run executes the workflow's current version, so save first.
      const id = await get().saveToEngine(team);
      if (!id) return failRun("Could not save the workflow before running.");

      let queued: RunDetail;
      try {
        queued = await startRun(team, id);
      } catch {
        return failRun("The engine rejected the run request.");
      }

      const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
      return await new Promise<WorkflowRunResult>((resolve) => {
        let settled = false;
        const finish = (final: RunDetail) => {
          if (settled) return;
          settled = true;
          const ok = final.status === "succeeded";
          const log = stepsToLog(final);
          set((s) => ({
            runState: ok ? "success" : "error",
            nodeExecutions: stepsToExecutions(final),
            runLog: log,
            lastRunAt: final.endedAt ?? new Date().toISOString(),
            runHistory: prependHistory(s.runHistory, {
              id: final.id,
              status: ok ? "success" : "error",
              startedAt,
              finishedAt: final.endedAt ?? new Date().toISOString(),
              durationMs: final.durationMs ?? 0,
              nodeCount: final.stepCount,
              log,
              error: final.error ?? undefined,
            }),
          }));
          get().persistDraft(team);
          resolve({ ok, orderedNodeIds: final.steps.map((st) => st.nodeId), log, error: final.error ?? undefined });
        };

        subscribeRun(queued.id, {
          onRun: (r) => {
            set({ nodeExecutions: stepsToExecutions(r), runLog: stepsToLog(r) });
            if (TERMINAL.has(r.status)) finish(r);
          },
          onError: () => finish({ ...queued, status: "failed", error: "Lost connection to the run stream.", steps: [] }),
        });
      });
    },
    persistDraft: (team) => {
      const { workflowId, workflowName, active, nodes, edges, runHistory } = get();
      return writeDraft(team, {
        version: WORKFLOW_STORAGE_VERSION,
        workflowId,
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
        workflowId: null,
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
