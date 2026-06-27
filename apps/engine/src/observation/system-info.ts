import { eq } from "drizzle-orm";
import { db, schema } from "../infra/db/client";
import { daemonDisplayName } from "../domains/runs/mappers";

const { daemons, runtimes } = schema;

export async function getSystemInfo(teamId: string) {
  const [daemonRows, runtimeRows] = await Promise.all([
    db.select().from(daemons).where(eq(daemons.teamId, teamId)),
    db
      .select({
        id: runtimes.id,
        daemonId: runtimes.daemonId,
        kind: runtimes.kind,
        status: runtimes.status,
      })
      .from(runtimes)
      .where(eq(runtimes.teamId, teamId)),
  ]);
  // Derive liveness from heartbeat freshness (daemon beats every ~5s).
  const STALE_MS = 15_000;
  const now = Date.now();
  const liveStatus = (hb: string | null): "online" | "offline" => {
    if (!hb) return "offline";
    // Postgres emits a 2-digit offset ("+00"); Date.parse needs "+00:00".
    const ts = Date.parse(
      hb.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
    );
    return !Number.isNaN(ts) && now - ts <= STALE_MS ? "online" : "offline";
  };
  // A runtime is *available* (selectable for a new agent) when its daemon is online AND
  // the backing CLI is actually present on that host. `echo` is self-contained; kinds we
  // don't probe (custom/openai/…) are trusted from the daemon's own registration.
  const onlineDaemonIds = new Set(
    daemonRows
      .filter((d) => liveStatus(d.lastHeartbeatAt) === "online")
      .map((d) => d.id),
  );
  const toolsByDaemon = new Map<string, Map<string, { available: boolean; authenticated?: boolean }>>();
  for (const d of daemonRows) {
    const tools =
      (d.meta as { tools?: Array<{ name: string; available: boolean; authenticated?: boolean }> } | null)
        ?.tools ?? [];
    toolsByDaemon.set(d.id, new Map(tools.map((t) => [t.name, { available: t.available, authenticated: t.authenticated }])));
  }
  const availableRuntimes = [
    ...new Set(
      runtimeRows
        .filter((rt) => {
          if (!onlineDaemonIds.has(rt.daemonId)) return false;
          const probed = toolsByDaemon.get(rt.daemonId)?.get(rt.kind);
          return rt.kind === "echo" || probed === undefined || probed.available === true;
        })
        .map((rt) => rt.kind),
    ),
  ].sort();
  const daemonById = new Map(daemonRows.map((d) => [d.id, d]));
  const runnableTargets = runtimeRows
    .map((rt) => {
      const daemon = daemonById.get(rt.daemonId);
      const daemonStatus = daemon ? liveStatus(daemon.lastHeartbeatAt) : "offline";
      const probed = toolsByDaemon.get(rt.daemonId)?.get(rt.kind);
      const cliAvailable = rt.kind === "echo" || probed === undefined || probed.available;
      const authenticated = rt.kind === "echo" || probed === undefined || Boolean(probed.authenticated);
      const available = daemonStatus === "online" && Boolean(cliAvailable);
      const reason =
        daemonStatus !== "online"
          ? "daemon_offline"
          : !cliAvailable
            ? "cli_missing"
            : !authenticated
              ? "auth_required"
              : null;
      return {
        daemonId: rt.daemonId,
        daemonName: daemonDisplayName(daemon),
        runtimeId: rt.id,
        runtimeKind: rt.kind,
        status: daemonStatus,
        available,
        authenticated,
        reason,
      };
    })
    .sort((a, b) => `${a.runtimeKind}:${a.daemonName}`.localeCompare(`${b.runtimeKind}:${b.daemonName}`));

  return {
    daemons: daemonRows.map((d) => ({
      id: d.id,
      name: d.name,
      status: liveStatus(d.lastHeartbeatAt),
      lastHeartbeatAt: d.lastHeartbeatAt,
      meta: d.meta ?? {},
      mode: ((d.meta as { mode?: string } | null)?.mode ?? "org") as
        | "personal"
        | "org"
        | "legacy",
    })),
    runtimes: runtimeRows,
    availableRuntimes,
    runnableTargets,
  };
}
