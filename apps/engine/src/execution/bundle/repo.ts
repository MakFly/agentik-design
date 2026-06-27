import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";
import type { BundleAction, BundleCommandStatus } from "../../infra/db/schema";

const { bundleCommands, orgSettings, daemons } = schema;

/* ── Persisted bundle policy (config-over-env) ───────────────────────── */

const NETWORK_INSTALL_KEY = "bundle.network_install";

/** Whether this org allows the daemon to run network installers. Default OFF (RCE-class op). */
export async function getNetworkInstallEnabled(
  teamId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ value: orgSettings.value })
    .from(orgSettings)
    .where(
      and(
        eq(orgSettings.teamId, teamId),
        eq(orgSettings.key, NETWORK_INSTALL_KEY),
      ),
    )
    .limit(1);
  return row?.value === true;
}

export async function setNetworkInstallEnabled(
  teamId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(orgSettings)
    .values({
      id: genId("oset"),
      teamId,
      key: NETWORK_INSTALL_KEY,
      value: enabled,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [orgSettings.teamId, orgSettings.key],
      set: { value: enabled, updatedAt: sql`now()` },
    });
}

/* ── Bundle commands ─────────────────────────────────────────────────── */

/** Actions that actually run a network installer (gated by the policy flag). */
const NETWORK_ACTIONS: BundleAction[] = ["install", "upgrade"];

export type EnqueueResult =
  | {
      ok: true;
      command: {
        id: string;
        kind: string;
        action: BundleAction;
        status: BundleCommandStatus;
      };
    }
  | {
      ok: false;
      error:
        | "daemon_not_found"
        | "network_install_disabled"
        | "command_in_flight";
    };

/**
 * Enqueue a bundle command for a daemon. install/upgrade require the org's
 * network-install policy to be ON. Refuses a duplicate while one is already in flight
 * for the same (daemon, kind) so a double-click can't launch two installers.
 */
export async function enqueueBundleCommand(
  teamId: string,
  input: {
    daemonId: string;
    kind: string;
    action: BundleAction;
    requestedBy?: string;
  },
): Promise<EnqueueResult> {
  const [d] = await db
    .select({ id: daemons.id })
    .from(daemons)
    .where(and(eq(daemons.id, input.daemonId), eq(daemons.teamId, teamId)))
    .limit(1);
  if (!d) return { ok: false, error: "daemon_not_found" };

  if (
    NETWORK_ACTIONS.includes(input.action) &&
    !(await getNetworkInstallEnabled(teamId))
  ) {
    return { ok: false, error: "network_install_disabled" };
  }

  const [inflight] = await db
    .select({ id: bundleCommands.id })
    .from(bundleCommands)
    .where(
      and(
        eq(bundleCommands.daemonId, input.daemonId),
        eq(bundleCommands.kind, input.kind),
        sql`${bundleCommands.status} in ('queued','running')`,
      ),
    )
    .limit(1);
  if (inflight) return { ok: false, error: "command_in_flight" };

  const id = genId("bcmd");
  await db.insert(bundleCommands).values({
    id,
    teamId,
    daemonId: input.daemonId,
    kind: input.kind,
    action: input.action,
    status: "queued",
    requestedBy: input.requestedBy ?? "",
  });
  hub.publish(teamId, { kind: "presence" });
  return {
    ok: true,
    command: { id, kind: input.kind, action: input.action, status: "queued" },
  };
}

export async function listBundleCommands(teamId: string, limit = 50) {
  return db
    .select()
    .from(bundleCommands)
    .where(eq(bundleCommands.teamId, teamId))
    .orderBy(desc(bundleCommands.createdAt))
    .limit(limit);
}

export async function getBundleCommandTeamId(
  commandId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ teamId: bundleCommands.teamId })
    .from(bundleCommands)
    .where(eq(bundleCommands.id, commandId))
    .limit(1);
  return row?.teamId ?? null;
}

/**
 * Atomically claim the next queued bundle command for a daemon (→ running).
 * FOR UPDATE SKIP LOCKED so a daemon can poll concurrently with task claims.
 */
export async function claimNextBundleCommand(daemonId: string) {
  const result = await db.execute(sql`
    WITH next AS (
      SELECT id FROM ${bundleCommands}
      WHERE daemon_id = ${daemonId} AND status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ${bundleCommands} b
    SET status = 'running', started_at = now()
    FROM next WHERE b.id = next.id
    RETURNING b.id AS "id", b.team_id AS "teamId", b.kind AS "kind", b.action AS "action";
  `);
  const rows = result as unknown as Array<{
    id: string;
    teamId: string;
    kind: string;
    action: BundleAction;
  }>;
  const cmd = rows[0] ?? null;
  if (cmd) hub.publish(cmd.teamId, { kind: "presence" });
  return cmd;
}

/** Report terminal status for a bundle command (done|failed) with an optional summary. */
export async function reportBundleStatus(
  commandId: string,
  input: { status: "done" | "failed"; result?: string; error?: string },
): Promise<boolean> {
  const updated = await db
    .update(bundleCommands)
    .set({
      status: input.status,
      result: input.result ?? null,
      error: input.error ?? null,
      endedAt: sql`now()`,
    })
    .where(
      and(
        eq(bundleCommands.id, commandId),
        eq(bundleCommands.status, "running"),
      ),
    )
    .returning({ id: bundleCommands.id, teamId: bundleCommands.teamId });
  if (!updated[0]) return false;
  hub.publish(updated[0].teamId, { kind: "presence" });
  return true;
}
