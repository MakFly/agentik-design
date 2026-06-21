import type { RunStatus } from "@/types/domain";

/**
 * Lanes of the runs kanban. Order matters — it's the left→right column order.
 * Statuses not listed here (cancelled, timed_out) never get a column; the mock
 * stream only ever emits the six below. `StatusBadge` remains the single source
 * of truth for label + icon + tone, so we only carry the column tint here.
 */
export interface RunColumn {
  status: RunStatus;
  /** subtle background tint behind the column body */
  tint: string;
}

export const RUN_COLUMNS: RunColumn[] = [
  { status: "queued", tint: "bg-surface-2" },
  { status: "running", tint: "bg-running/5" },
  { status: "waiting_approval", tint: "bg-info/5" },
  { status: "paused", tint: "bg-warning/5" },
  { status: "succeeded", tint: "bg-success/5" },
  { status: "failed", tint: "bg-danger/5" },
];

export const BOARD_STATUSES = RUN_COLUMNS.map((c) => c.status);

export const BOARD_COL_WIDTH = 300;
export const BOARD_CARD_WIDTH = BOARD_COL_WIDTH - 16 - 8; // col(300) - col p-2(16) - body p-1(8)
