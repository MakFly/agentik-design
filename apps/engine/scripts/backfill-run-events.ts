/**
 * One-off backfill: give every historical run a complete run_events ledger from its
 * run_messages. Idempotent (onConflictDoNothing on (runId, seq)) — safe to re-run.
 *
 * This is step (a) of the run_events migration: it makes the V2 /runs/:id/events
 * reader return full history for runs created before the live dual-write existed.
 * It does NOT touch the SSE live projection (step b — see backfillRunEvents docs).
 *
 *   bun run apps/engine/scripts/backfill-run-events.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/infra/db/client";
import { backfillRunEvents } from "../src/execution/daemon/repo";

const rows = (await db.execute(sql`
  SELECT DISTINCT rm.run_id AS "runId"
  FROM run_messages rm
  WHERE NOT EXISTS (
    SELECT 1 FROM run_events re WHERE re.run_id = rm.run_id
  )
`)) as unknown as Array<{ runId: string }>;

console.log(`[backfill] ${rows.length} run(s) without run_events`);

let total = 0;
for (const { runId } of rows) {
  const n = await backfillRunEvents(runId);
  total += n;
  if (n > 0) console.log(`[backfill] ${runId}: +${n} events`);
}

console.log(`[backfill] done — ${total} run_events inserted across ${rows.length} run(s)`);
process.exit(0);
