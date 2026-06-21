"use client";

import { memo, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Run } from "@/types/domain";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { BOARD_COL_WIDTH, type RunColumn } from "./config";
import { DraggableRunCard } from "./run-card";

export const BoardColumn = memo(function BoardColumn({
  column,
  runIds,
  runMap,
  team,
}: {
  column: RunColumn;
  runIds: string[];
  runMap: Map<string, Run>;
  team: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  const resolved = useMemo(
    () => runIds.flatMap((id) => (runMap.get(id) ? [runMap.get(id)!] : [])),
    [runIds, runMap],
  );

  return (
    <div
      style={{ width: BOARD_COL_WIDTH }}
      className={cn("flex shrink-0 flex-col rounded-xl p-2", column.tint)}
    >
      <div className="mb-2 flex items-center gap-2 px-1.5">
        <StatusBadge status={column.status} size="sm" />
        <span className="ml-auto shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {runIds.length}
        </span>
      </div>

      <div className="relative min-h-[160px] flex-1 rounded-lg">
        <div
          ref={setNodeRef}
          className={cn(
            "absolute inset-0 space-y-2 overflow-y-auto rounded-lg p-1 transition-colors",
            isOver && "bg-accent/60",
          )}
        >
          <SortableContext items={runIds} strategy={verticalListSortingStrategy}>
            {resolved.map((run) => (
              <DraggableRunCard key={run.id} run={run} team={team} />
            ))}
          </SortableContext>
          {runIds.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">No runs</p>
          )}
        </div>
      </div>
    </div>
  );
});
