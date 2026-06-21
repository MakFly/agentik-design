/**
 * Derive live agent presence (availability × workload) from the single
 * agent-task snapshot — the multica pattern. One query backs every agent's
 * presence read, so the agents page never fans out N requests.
 */

export interface AgentTaskSnapshot {
  agents: Array<{ id: string; name: string; runtimeKind: string; maxConcurrentTasks: number; health: string }>;
  daemons: Array<{ id: string; name: string; status: string; lastHeartbeatAt: string | null }>;
  runtimes: Array<{ id: string; daemonId: string; kind: string; status: string }>;
  activeTasks: Array<{ id: string; agentId: string; status: string }>;
}

export type Availability = "online" | "unstable" | "offline";
export type Workload = "working" | "queued" | "idle";

export interface AgentPresence {
  availability: Availability;
  workload: Workload;
  runningCount: number;
  queuedCount: number;
  capacity: number;
}

const FRESH_MS = 15_000; // ~3 missed heartbeats
const GRACE_MS = 5 * 60_000;

function heartbeatAge(snapshot: AgentTaskSnapshot, runtimeKind: string): number | null {
  // Freshest heartbeat among daemons that host an online runtime of this kind.
  const daemonIds = new Set(snapshot.runtimes.filter((r) => r.kind === runtimeKind && r.status === "online").map((r) => r.daemonId));
  let best: number | null = null;
  for (const d of snapshot.daemons) {
    if (!daemonIds.has(d.id) || !d.lastHeartbeatAt) continue;
    // Postgres emits a 2-digit offset ("+00"); Date.parse needs "+00:00".
    const ts = Date.parse(d.lastHeartbeatAt.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    if (Number.isNaN(ts)) continue;
    const age = Date.now() - ts;
    if (best === null || age < best) best = age;
  }
  return best;
}

export function derivePresence(
  snapshot: AgentTaskSnapshot | undefined,
  agent: { id: string; runtimeKind: string; maxConcurrentTasks?: number },
): AgentPresence {
  const capacity = agent.maxConcurrentTasks ?? 1;
  const tasks = snapshot?.activeTasks.filter((t) => t.agentId === agent.id) ?? [];
  const runningCount = tasks.filter((t) => t.status === "running" || t.status === "dispatched").length;
  const queuedCount = tasks.filter((t) => t.status === "queued").length;
  const workload: Workload = runningCount > 0 ? "working" : queuedCount > 0 ? "queued" : "idle";

  let availability: Availability = "offline";
  if (snapshot) {
    const age = heartbeatAge(snapshot, agent.runtimeKind);
    if (age !== null) availability = age <= FRESH_MS ? "online" : age <= GRACE_MS ? "unstable" : "offline";
  }

  return { availability, workload, runningCount, queuedCount, capacity };
}
