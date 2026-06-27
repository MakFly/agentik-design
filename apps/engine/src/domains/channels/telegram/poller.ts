import { sql } from "drizzle-orm";
import { db } from "../../../infra/db/client";
import { listPollableConnections, pollTelegramConnection } from "../repo";
import { env } from "../../../infra/env";

/**
 * Long-polling driver for Telegram channels (OpenClaw/Hermes-style). This is the
 * DEFAULT transport: the engine pulls updates with getUpdates, so a bot works with
 * only a token — no public URL, tunnel, or webhook required.
 *
 * Single-owner across processes/instances: each tick grabs a Postgres advisory
 * xact-lock so exactly one engine polls a given token. Telegram returns HTTP 409
 * if two pollers share a token, so this guard is essential, not just an optimization.
 */

/** Stable key (distinct from the task-scanner's) so every instance contends for the same lock. */
export const TELEGRAM_POLL_LOCK_KEY = 4242420002;
const TICK_MS = env.TELEGRAM_POLL_INTERVAL_MS;

export interface PollTickResult {
  skipped: boolean; // another instance held the lock
  connections: number;
  updates: number;
}

/** One poll pass across all active polling connections. Exposed for deterministic tests. */
export async function pollTelegramOnce(): Promise<PollTickResult> {
  return db.transaction(async (tx) => {
    const lock = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${TELEGRAM_POLL_LOCK_KEY}) AS got`,
    )) as unknown as Array<{ got: boolean }>;
    if (!lock[0]?.got) return { skipped: true, connections: 0, updates: 0 };

    const connections = await listPollableConnections();
    let updates = 0;
    for (const connection of connections) {
      const n = await pollTelegramConnection(connection);
      if (n > 0) updates += n;
    }
    return { skipped: false, connections: connections.length, updates };
  });
}

/** Start the periodic poller. Returns a stop() to clear the interval. */
export function startTelegramPolling(): () => void {
  let running = false;
  const tick = () => {
    if (running) return; // never overlap ticks — a slow getUpdates must not stack
    running = true;
    void pollTelegramOnce()
      .catch((err) => console.error("[telegram-poll] tick failed:", err))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, TICK_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  tick();
  console.log(`[telegram-poll] started (tick every ${TICK_MS}ms)`);
  return () => clearInterval(timer);
}
