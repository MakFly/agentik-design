"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Bot, Columns3, Filter, ListTodo, Radio, Workflow } from "lucide-react";
import { useQueryState } from "nuqs";
import type { Run, RunStatus } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOARD_CARD_WIDTH, BOARD_STATUSES, RUN_COLUMNS } from "./config";
import { buildColumns, findColumn, makeKanbanCollision } from "./drag-utils";
import { BoardColumn } from "./run-column";
import { RunCardContent } from "./run-card";
import { useRunsStream } from "./use-runs-stream";

const COLUMN_IDS = new Set<string>(BOARD_STATUSES);
const collisionDetection = makeKanbanCollision(COLUMN_IDS);

const RUN_SCOPES = ["all", "active", "needs_review", "finished"] as const;
type RunScope = (typeof RUN_SCOPES)[number];

const SCOPE_LABEL: Record<RunScope, string> = {
  all: "All",
  active: "Active",
  needs_review: "Needs review",
  finished: "Finished",
};

function scopeForRun(run: Run): RunScope[] {
  const scopes: RunScope[] = ["all"];
  if (run.status === "queued" || run.status === "running" || run.status === "paused") scopes.push("active");
  if (run.status === "waiting_approval" || run.status === "failed") scopes.push("needs_review");
  if (run.status === "succeeded" || run.status === "cancelled" || run.status === "timed_out") scopes.push("finished");
  return scopes;
}

export function RunsBoard({ team }: { team: string }) {
  const { runs, status, applyLocalMove } = useRunsStream(team);
  const [scopeParam, setScopeParam] = useQueryState("scope");
  const scope = RUN_SCOPES.includes(scopeParam as RunScope) ? (scopeParam as RunScope) : "all";

  const runList = useMemo(() => Array.from(runs.values()), [runs]);
  const visibleRuns = useMemo(
    () => runList.filter((run) => scopeForRun(run).includes(scope)),
    [runList, scope],
  );
  const visibleRunMap = useMemo(() => new Map(visibleRuns.map((run) => [run.id, run])), [visibleRuns]);
  const scopeCounts = useMemo(() => {
    const counts: Record<RunScope, number> = { all: 0, active: 0, needs_review: 0, finished: 0 };
    for (const run of runList) {
      for (const bucket of scopeForRun(run)) counts[bucket]++;
    }
    return counts;
  }, [runList]);
  const activeCount = runList.filter(
    (r) => r.status === "running" || r.status === "queued" || r.status === "waiting_approval",
  ).length;
  const agentRuns = runList.filter((run) => run.subject.kind === "agent").length;
  const workflowRuns = runList.length - agentRuns;

  const isDraggingRef = useRef(false);

  const [columns, setColumns] = useState<Record<string, string[]>>(() =>
    buildColumns(visibleRuns, BOARD_STATUSES),
  );

  // Mirror latest state into refs (in effects, not during render) so the drag
  // handlers can read them at event time.
  const runsRef = useRef(runs);
  const columnsRef = useRef(columns);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  // Between drags, follow the stream. Frozen while dragging so deltas don't
  // fight the local preview (iso multica).
  useEffect(() => {
    if (!isDraggingRef.current) setColumns(buildColumns(visibleRuns, BOARD_STATUSES));
  }, [visibleRuns]);

  // Lock collision for one frame after a cross-column move so it can't oscillate.
  const recentlyMovedRef = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      recentlyMovedRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [columns]);

  const [activeRun, setActiveRun] = useState<Run | null>(null);

  // Mouse: small move threshold so clicks still navigate to the run.
  // Touch: press-and-hold to drag, leaving short swipes free to scroll columns.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true;
    setActiveRun(runsRef.current.get(event.active.id as string) ?? null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || recentlyMovedRef.current) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    setColumns((prev) => {
      const activeCol = findColumn(prev, activeId, COLUMN_IDS);
      const overCol = findColumn(prev, overId, COLUMN_IDS);
      if (!activeCol || !overCol || activeCol === overCol) return prev;

      recentlyMovedRef.current = true;
      const fromIds = prev[activeCol]!.filter((id) => id !== activeId);
      const toIds = [...prev[overCol]!];
      const overIndex = toIds.indexOf(overId);
      toIds.splice(overIndex >= 0 ? overIndex : toIds.length, 0, activeId);
      return { ...prev, [activeCol]: fromIds, [overCol]: toIds };
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      isDraggingRef.current = false;
      setActiveRun(null);

      const reset = () => {
        const latest = Array.from(runsRef.current.values()).filter((run) => scopeForRun(run).includes(scope));
        setColumns(buildColumns(latest, BOARD_STATUSES));
      };
      if (!over) return reset();

      const activeId = active.id as string;
      const overId = over.id as string;
      const cols = columnsRef.current;
      const activeCol = findColumn(cols, activeId, COLUMN_IDS);
      const overCol = findColumn(cols, overId, COLUMN_IDS);
      if (!activeCol || !overCol) return reset();

      // Same-column reorder: local-only (no positions in the mock model).
      if (activeCol === overCol) {
        const ids = cols[activeCol]!;
        const from = ids.indexOf(activeId);
        const to = ids.indexOf(overId);
        if (from !== -1 && to !== -1 && from !== to) {
          setColumns({ ...cols, [activeCol]: arrayMove(ids, from, to) });
        }
        return;
      }

      // Cross-column: the drag changed the run's status. Persist to the stream
      // source so the resync keeps it there.
      applyLocalMove(activeId, overCol as RunStatus);
    },
    [applyLocalMove, scope],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-1 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListTodo className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-sm font-medium">Runs</h1>
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{runList.length}</span>
          <p className="ml-2 hidden truncate text-xs text-muted-foreground md:block">
            Agent and workflow execution board
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
              status === "live"
                ? "border-success/20 bg-success/10 text-success"
                : status === "error"
                  ? "border-danger/20 bg-danger/10 text-danger"
                  : "border-border bg-surface-2 text-muted-foreground",
            )}
          >
            <Radio className={cn("size-3.5", status === "live" && "animate-pulse")} aria-hidden="true" />
            {status === "live" ? "Live" : status === "error" ? "Offline" : "Connecting"}
          </span>
          <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 text-muted-foreground md:inline-flex">
            <Columns3 className="size-3.5" />
            Board
          </Button>
        </div>
      </div>

      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {RUN_SCOPES.map((item) => {
            const active = scope === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setScopeParam(item === "all" ? null : item)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {SCOPE_LABEL[item]}
                <span className="font-mono tabular-nums text-muted-foreground/70">{scopeCounts[item]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Bot className="size-3.5" />
            <span className="tabular-nums">{agentRuns}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Workflow className="size-3.5" />
            <span className="tabular-nums">{workflowRuns}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Filter className="size-3.5" />
            <span className="tabular-nums">{visibleRuns.length}</span>
            shown
          </span>
          <span className="tabular-nums">{activeCount} active</span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pt-4 pb-2">
          {RUN_COLUMNS.map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              runIds={columns[column.status] ?? []}
              runMap={visibleRunMap}
              team={team}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeRun ? (
            <div style={{ width: BOARD_CARD_WIDTH }} className="rotate-1 cursor-grabbing opacity-90 shadow-lg shadow-black/10">
              <RunCardContent run={activeRun} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
