"use client";

import { useCallback, useMemo, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import { AlertTriangle, CheckCircle2, Loader2, Plus } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./canvas-styles.css";
import { useWorkflowStore } from "./store";
import { WorkflowNode } from "./workflow-node";
import { WorkflowEdge } from "./workflow-edge";
import { createNode } from "./utils";
import type { NodeType } from "@/types/domain";

const nodeTypes: NodeTypes = { workflow: WorkflowNode };
const edgeTypes: EdgeTypes = { workflow: WorkflowEdge };

export function Canvas() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const setPaletteOpen = useWorkflowStore((s) => s.setPaletteOpen);
  const runState = useWorkflowStore((s) => s.runState);
  const nodeExecutions = useWorkflowStore((s) => s.nodeExecutions);
  const runLog = useWorkflowStore((s) => s.runLog);
  const lastRunAt = useWorkflowStore((s) => s.lastRunAt);
  const runHistory = useWorkflowStore((s) => s.runHistory);
  const showExecutions = useWorkflowStore((s) => s.showExecutions);

  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData("application/agentik-node") as NodeType;
      if (!nodeType) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(createNode(nodeType, position));
    },
    [screenToFlowPosition, addNode],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => selectNode(node.id),
    [selectNode],
  );

  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

  const defaultEdgeOptions = useMemo(
    () => ({ type: "workflow" as const }),
    [],
  );

  // Real run progress derived from per-node execution state.
  const totalSteps = nodes.length;
  const doneSteps = useMemo(
    () => Object.values(nodeExecutions).filter((e) => e.status === "success").length,
    [nodeExecutions],
  );
  const runningLabel = useMemo(() => {
    const runningId = Object.entries(nodeExecutions).find(([, e]) => e.status === "running")?.[0];
    if (!runningId) return null;
    return (nodes.find((n) => n.id === runningId)?.data as { label?: string } | undefined)?.label ?? null;
  }, [nodeExecutions, nodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      // Cap the zoom so a small graph (1-2 nodes) doesn't fill the screen.
      fitViewOptions={{ padding: 0.3, maxZoom: 0.85 }}
      proOptions={{ hideAttribution: true }}
      deleteKeyCode={null}
      snapToGrid
      snapGrid={[20, 20]}
      className="!bg-[var(--n8n-canvas)]"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="var(--n8n-canvas-dot)"
      />
      {runState === "running" && (
        <div className="wf-progress-track" aria-hidden>
          <div className="wf-progress-bar" />
        </div>
      )}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {runState === "running" && (
          <span
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-2.5 text-xs text-foreground shadow-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-3.5 animate-spin text-[var(--n8n-brand)]" />
            <span className="truncate max-w-[180px]">
              {runningLabel ? `Running · ${runningLabel}` : "Running…"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {doneSteps}/{totalSteps}
            </span>
          </span>
        )}
        {runState === "success" && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-2.5 text-xs text-success shadow-sm">
            <CheckCircle2 className="size-3.5" />
            Last run succeeded
          </span>
        )}
        {runState === "error" && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-2.5 text-xs text-danger shadow-sm">
            <AlertTriangle className="size-3.5" />
            Last run failed
          </span>
        )}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-[var(--n8n-hover)]"
        >
          <Plus className="size-3.5" />
          Add node
        </button>
      </div>
      {runLog.length > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 w-[min(560px,calc(100%-120px))] -translate-x-1/2 rounded-lg border border-[var(--n8n-border)] bg-[var(--n8n-surface)] shadow-[0_12px_32px_rgb(15_23_42/0.16)]">
          <div className="flex items-center justify-between border-b border-[var(--n8n-border)] px-3 py-2">
            <div className="flex items-center gap-2">
              {runState === "error" ? (
                <AlertTriangle className="size-4 text-danger" />
              ) : (
                <CheckCircle2 className="size-4 text-success" />
              )}
              <p className="text-xs font-semibold text-foreground">Execution</p>
            </div>
            {lastRunAt && (
              <p className="text-[11px] text-muted-foreground">
                {new Date(lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            )}
          </div>
          <div className="max-h-36 overflow-auto p-2">
            {runLog.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--n8n-hover)]">
                {entry.status === "error" ? (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{entry.label}</p>
                  <p className="truncate text-muted-foreground">{entry.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {showExecutions && (
        <div className="absolute right-4 top-16 z-10 w-[320px] rounded-lg border border-[var(--n8n-border)] bg-[var(--n8n-surface)] shadow-[0_12px_32px_rgb(15_23_42/0.16)]">
          <div className="border-b border-[var(--n8n-border)] px-3 py-2">
            <p className="text-xs font-semibold text-foreground">Execution history</p>
            <p className="text-[11px] text-muted-foreground">Local runs saved with this workflow</p>
          </div>
          <div className="max-h-80 overflow-auto p-2">
            {runHistory.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No executions yet
              </p>
            ) : (
              runHistory.map((run) => (
                <div key={run.id} className="rounded-md px-2 py-2 text-xs hover:bg-[var(--n8n-hover)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {run.status === "success" ? (
                        <CheckCircle2 className="size-3.5 text-success" />
                      ) : (
                        <AlertTriangle className="size-3.5 text-danger" />
                      )}
                      {run.status === "success" ? "Succeeded" : "Failed"}
                    </span>
                    <span className="text-[11px] tabular text-muted-foreground">
                      {run.durationMs} ms
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{run.nodeCount} node{run.nodeCount === 1 ? "" : "s"}</span>
                    <span>{new Date(run.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  </div>
                  {run.error && <p className="mt-1 truncate text-[11px] text-danger">{run.error}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <Controls
        showInteractive={false}
        position="bottom-left"
        style={{ margin: 16 }}
      />
      <MiniMap
        nodeStrokeWidth={3}
        maskColor="var(--overlay)"
        nodeColor="var(--surface-3)"
        position="bottom-right"
        style={{ margin: 16 }}
      />
    </ReactFlow>
  );
}
