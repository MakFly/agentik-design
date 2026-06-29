import { pointerWithin, closestCenter, type CollisionDetection } from "@dnd-kit/core";
import type { Run, RunStatus } from "@/types/domain";

/**
 * Kanban collision (iso multica): prefer the card directly under the pointer,
 * fall back to the column, then to closestCenter when the pointer leaves the
 * board. Filtering out column ids when a card is hit keeps cross-column drops
 * from snapping to the column header.
 */
export function makeKanbanCollision(columnIds: Set<string>): CollisionDetection {
  return (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const cards = pointer.filter((c) => !columnIds.has(c.id as string));
      return cards.length > 0 ? cards : pointer;
    }
    return closestCenter(args);
  };
}

/**
 * Identity used to MERGE runs into a single board card: runs of the same task
 * (and, lacking a task, the same agent) collapse together so an agent never
 * shows as N separate cards. Falls back to the run id (workflow/orchestration
 * runs stay distinct).
 */
export function runMergeKey(run: Run): string {
  if (run.taskId) return `task:${run.taskId}`;
  if (run.subject.kind === "agent") return `agent:${run.subject.agentId}`;
  return run.id;
}

/** Column id === RunStatus. Run ids ("run_…") never collide with these. */
export function buildColumns(runs: Run[], statuses: RunStatus[]): Record<string, string[]> {
  const cols: Record<string, string[]> = {};
  for (const s of statuses) cols[s] = [];
  for (const r of runs) cols[r.status]?.push(r.id);
  return cols;
}

export function findColumn(
  columns: Record<string, string[]>,
  id: string,
  columnIds: Set<string>,
): string | null {
  if (columnIds.has(id)) return id;
  for (const [columnId, ids] of Object.entries(columns)) {
    if (ids.includes(id)) return columnId;
  }
  return null;
}
