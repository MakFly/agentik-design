/**
 * Embedded in-process worker — the solo-mode equivalent of a remote Go daemon.
 * It registers a local "embedded" daemon per team, then claims the SAME Postgres
 * runs queue (FOR UPDATE SKIP LOCKED) and drives each task through the very same
 * service layer the daemon HTTP routes use (claim → start → messages → complete),
 * so all engine machinery (cred injection, learned context, side-effects) is
 * reused verbatim. Execution itself goes through a pluggable adapter:
 * CLI → API → "needs setup". Coexists with remote daemons against one queue.
 *
 * Start it behind EMBEDDED_WORKER=true (mirrors DAEMON_ENABLED/SCHEDULER_ENABLED).
 */
import { db, schema } from "../../infra/db/client";
import { registerDaemon, heartbeat } from "../daemon/repo";
import {
  appendMessages,
  claimTask,
  completeTask,
  failTask,
  startTask,
  type ClaimedTask,
} from "../daemon/service";
import { resolveAdapter, SETUP_HINT } from "./runtime/resolve";
import type { RuntimeAdapter } from "./runtime/types";

/** Runtime kinds the embedded worker advertises (superset of agent kinds). */
const RUNTIME_KINDS = ["claude", "codex", "hermes", "openai", "anthropic", "google"];
const HEARTBEAT_MS = 5_000;
const CLAIM_IDLE_MS = 1_000;

export interface RegisteredRuntime {
  daemonId: string;
  teamId: string;
  runtimeId: string;
  kind: string;
}

export type AdapterResolver = (
  task: ClaimedTask,
  kind: string,
) => RuntimeAdapter | null;

/** Register one embedded daemon per team, advertising every runtime kind. */
export async function registerEmbeddedRuntimes(): Promise<RegisteredRuntime[]> {
  const teams = await db.select({ id: schema.teams.id }).from(schema.teams);
  const out: RegisteredRuntime[] = [];
  for (const t of teams) {
    const res = await registerDaemon({
      teamId: t.id,
      name: "embedded",
      meta: { deviceId: `embedded:${t.id}`, embedded: true },
      runtimes: RUNTIME_KINDS.map((kind) => ({
        kind,
        capabilities: { maxConcurrent: 1 },
      })),
    });
    for (const rt of res.runtimes)
      out.push({ daemonId: res.daemonId, teamId: t.id, runtimeId: rt.id, kind: rt.kind });
  }
  return out;
}

/** Drive one claimed task to a terminal state through the shared service layer. */
async function processClaimedTask(
  task: ClaimedTask,
  kind: string,
  resolve: AdapterResolver,
): Promise<string> {
  await startTask(task.id);

  const adapter = resolve(task, kind);
  if (!adapter) {
    await appendMessages(task.id, [{ seq: 1, type: "error", content: SETUP_HINT }]);
    await failTask(task.id, SETUP_HINT, "agent_error");
    return "needs_setup";
  }

  const controller = new AbortController();
  try {
    const { result } = await adapter.run(
      task,
      (messages) => appendMessages(task.id, messages),
      controller.signal,
    );
    const merged =
      result && typeof result === "object"
        ? { ...(result as Record<string, unknown>), runtime: adapter.label }
        : { result, runtime: adapter.label };
    await completeTask(task.id, merged);
    return "succeeded";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // High seq so the error never collides with adapter-emitted message seqs.
    await appendMessages(task.id, [
      { seq: 1_000_000, type: "error", content: msg },
    ]).catch(() => {});
    await failTask(task.id, msg, "agent_error");
    return "failed";
  }
}

/**
 * Claim and process at most one task for a runtime. Returns null when the queue is
 * empty for this runtime. Exported (with an injectable resolver) for tests.
 */
export async function claimAndProcessOnce(
  runtimeId: string,
  kind: string,
  resolve: AdapterResolver = resolveAdapter,
): Promise<{ runId: string; status: string } | null> {
  const task = await claimTask(runtimeId);
  if (!task) return null;
  const status = await processClaimedTask(task, kind, resolve);
  return { runId: task.id, status };
}

/** Boot the worker: register, heartbeat, then poll-claim across all runtimes. */
export function startEmbeddedWorker(): void {
  let stopped = false;
  void (async () => {
    const runtimes = await registerEmbeddedRuntimes();
    const teamCount = new Set(runtimes.map((r) => r.teamId)).size;
    console.log(
      `[embedded-worker] online — ${runtimes.length} runtime(s) across ${teamCount} team(s)`,
    );

    const daemonIds = [...new Set(runtimes.map((r) => r.daemonId))];
    const hb = setInterval(() => {
      for (const id of daemonIds) void heartbeat(id).catch(() => {});
    }, HEARTBEAT_MS);

    while (!stopped) {
      let worked = false;
      for (const rt of runtimes) {
        const res = await claimAndProcessOnce(rt.runtimeId, rt.kind).catch(
          (e) => {
            console.error("[embedded-worker] tick error", e);
            return null;
          },
        );
        if (res) {
          worked = true;
          console.log(`[embedded-worker] ${rt.kind} run ${res.runId} → ${res.status}`);
        }
      }
      if (!worked) await Bun.sleep(CLAIM_IDLE_MS);
    }
    clearInterval(hb);
  })();
}
