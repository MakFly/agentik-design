"use client";

import { memo, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Run } from "@/types/domain";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { BOARD_COL_WIDTH, type RunColumn } from "./config";
import { runMergeKey } from "./drag-utils";
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

  // Merge runs of the same task/agent into one card. The first occurrence (runs
  // arrive newest-first) is the representative the card links to and DnD moves;
  // `count` shows how many runs collapsed into it for this status.
  const groups = useMemo(() => {
    const map = new Map<string, { rep: Run; count: number }>();
    for (const run of resolved) {
      const key = runMergeKey(run);
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, { rep: run, count: 1 });
    }
    return Array.from(map.values());
  }, [resolved]);

  const repIds = useMemo(() => groups.map((g) => g.rep.id), [groups]);

  return (
    <div
      style={{ width: BOARD_COL_WIDTH }}
      className={cn("flex shrink-0 flex-col rounded-xl p-2", column.tint)}
    >
      <div className="mb-2 flex items-center gap-2 px-1.5">
        <StatusBadge status={column.status} size="sm" />
        <span
          className="ml-auto shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
          title={groups.length === runIds.length ? undefined : `${groups.length} cards · ${runIds.length} runs`}
        >
          {groups.length === runIds.length ? runIds.length : `${groups.length}/${runIds.length}`}
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
          <SortableContext items={repIds} strategy={verticalListSortingStrategy}>
            {groups.map((g) => (
              <DraggableRunCard key={g.rep.id} run={g.rep} team={team} count={g.count} />
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
