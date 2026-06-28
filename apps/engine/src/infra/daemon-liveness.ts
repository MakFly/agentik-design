import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";

const { daemons, runtimes } = schema;

/**
 * A daemon is considered live when its last heartbeat is fresher than this. Daemons
 * beat every ~5s, so 15s tolerates a couple of missed beats without false negatives.
 * This is the single source of truth for liveness — consumed by both the run-dispatch
 * guard (fail fast before enqueuing) and the system-info observation endpoint.
 */
export const DAEMON_STALE_MS = 15_000;

/** Parse a Postgres timestamp string and decide whether it is within the stale window. */
export function isHeartbeatFresh(hb: string | null, now = Date.now()): boolean {
  if (!hb) return false;
  // Postgres emits a 2-digit offset ("+00"); Date.parse needs "+00:00".
  const ts = Date.parse(hb.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return !Number.isNaN(ts) && now - ts <= DAEMON_STALE_MS;
}

/**
 * True when at least one daemon can actually claim a run for this agent: a runtime of the
 * agent's kind, advertised by a daemon whose heartbeat is fresh, respecting the optional
 * machine pin. Mirrors the eligibility half of `claimTask` so a run is only enqueued when
 * something is alive to pick it up — otherwise it would sit `queued` forever (a daemon that
 * is down never claims, and the task-scanner only times out runs already dispatched).
 */
export async function hasLiveDaemonForAgent(
  teamId: string,
  agent: { runtimeKind?: string | null; preferredDaemonId?: string | null },
): Promise<boolean> {
  const kind = agent.runtimeKind ?? "echo";
  const rows = await db
    .select({ one: sql`1` })
    .from(runtimes)
    .innerJoin(daemons, eq(daemons.id, runtimes.daemonId))
    .where(
      and(
        eq(runtimes.teamId, teamId),
        eq(runtimes.kind, kind),
        sql`${daemons.lastHeartbeatAt} > now() - make_interval(secs => ${DAEMON_STALE_MS / 1000})`,
        agent.preferredDaemonId ? eq(daemons.id, agent.preferredDaemonId) : sql`true`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
