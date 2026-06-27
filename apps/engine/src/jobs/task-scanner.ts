import { sql } from "drizzle-orm";
import { db } from "../infra/db/client";
import { autoRetryTask } from "../execution/daemon/repo";
import { failTask } from "../execution/daemon/service";

/**
 * Lifecycle scanner: periodically fails tasks that are stuck past their deadline and
 * auto-retries the retryable ones. It is the SINGLE owner of timeout + auto-retry
 * policy (daemon-reported failures are terminal `agent_error` and never retried here).
 *
 * Single-owner guarantee across processes/instances: each tick runs inside a
 * transaction guarded by a Postgres advisory xact-lock, which auto-releases on
 * commit. If another instance holds it, this tick is a no-op. The underlying
 * UPDATEs are idempotent anyway, so a missed/duplicate tick is harmless.
 */

/** dispatched but never started → the runtime never picked it up. */
const DISPATCHED_TIMEOUT = "5 minutes";
/** running far too long → a stuck/hung run. */
const RUNNING_TIMEOUT = "2.5 hours";
/** Total attempts allowed (initial + 1 auto-retry) for a retryable chat failure. */
const MAX_ATTEMPTS = 2;
/** Arbitrary, stable key so every engine instance contends for the same lock. */
export const SCANNER_LOCK_KEY = 4242420001;
const TICK_MS = 30_000;

interface StaleTask {
  id: string;
  kind: string;
  attempt: number;
}

export interface ScanResult {
  skipped: boolean; // another instance held the lock
  timedOut: number;
  retried: number;
}

/**
 * One scan pass. Returns counts; `skipped` when another instance owned the lock.
 * Exposed (not just the interval) so tests can drive it deterministically.
 */
export async function scanStaleTasks(): Promise<ScanResult> {
  return db.transaction(async (tx) => {
    const lock = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${SCANNER_LOCK_KEY}) AS got`,
    )) as unknown as Array<{ got: boolean }>;
    if (!lock[0]?.got) return { skipped: true, timedOut: 0, retried: 0 };

    const stale = (await tx.execute(sql`
      SELECT id, kind, attempt
      FROM runs
      WHERE executor = 'daemon'
        AND (
          (status = 'queued' AND dispatched_at IS NOT NULL
            AND dispatched_at < now() - interval '${sql.raw(DISPATCHED_TIMEOUT)}')
          OR (status = 'running'
            AND started_at < now() - interval '${sql.raw(RUNNING_TIMEOUT)}')
        )
    `)) as unknown as StaleTask[];

    let timedOut = 0;
    let retried = 0;
    for (const t of stale) {
      if (!(await failTask(t.id, "Task timed out", "timeout"))) continue;
      timedOut++;
      // Auto-retry: only chat-triggered tasks, only a retryable reason (timeout is),
      // and only within the attempt ceiling. Reuses the same row (one run identity).
      if (t.kind === "chat" && t.attempt < MAX_ATTEMPTS) {
        if (await autoRetryTask(t.id, t.attempt)) retried++;
      }
    }
    return { skipped: false, timedOut, retried };
  });
}

/** Start the periodic scanner. Returns a stop() to clear the interval. */
export function startTaskScanner(): () => void {
  const timer = setInterval(() => {
    void scanStaleTasks().catch((err) => console.error("[task-scanner] tick failed:", err));
  }, TICK_MS);
  // Don't keep the process alive solely for the scanner.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  console.log("[task-scanner] started (tick every 30s)");
  return () => clearInterval(timer);
}
