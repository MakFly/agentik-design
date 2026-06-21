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
import { Radio } from "lucide-react";
import type { Run, RunStatus } from "@/types/domain";
import { cn } from "@/lib/utils";
import { BOARD_CARD_WIDTH, BOARD_STATUSES, RUN_COLUMNS } from "./config";
import { buildColumns, findColumn, makeKanbanCollision } from "./drag-utils";
import { BoardColumn } from "./run-column";
import { RunCardContent } from "./run-card";
import { useRunsStream } from "./use-runs-stream";

const COLUMN_IDS = new Set<string>(BOARD_STATUSES);
const collisionDetection = makeKanbanCollision(COLUMN_IDS);

export function RunsBoard({ team }: { team: string }) {
  const { runs, status, applyLocalMove } = useRunsStream(team);

  const runList = useMemo(() => Array.from(runs.values()), [runs]);
  const activeCount = runList.filter(
    (r) => r.status === "running" || r.status === "queued" || r.status === "waiting_approval",
  ).length;

  const isDraggingRef = useRef(false);

  const [columns, setColumns] = useState<Record<string, string[]>>(() =>
    buildColumns(runList, BOARD_STATUSES),
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
    if (!isDraggingRef.current) setColumns(buildColumns(runList, BOARD_STATUSES));
  }, [runList]);

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

      const reset = () => setColumns(buildColumns(Array.from(runsRef.current.values()), BOARD_STATUSES));
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
    [applyLocalMove],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
            status === "live" ? "bg-success/10 text-success" : status === "error" ? "bg-danger/10 text-danger" : "bg-surface-2",
          )}
        >
          <Radio className={cn("size-3.5", status === "live" && "animate-pulse")} aria-hidden="true" />
          {status === "live" ? "Live" : status === "error" ? "Disconnected" : "Connecting…"}
        </span>
        <span className="tabular-nums">{activeCount} active</span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
          {RUN_COLUMNS.map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              runIds={columns[column.status] ?? []}
              runMap={runs}
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
