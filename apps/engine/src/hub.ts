import type { ServerWebSocket } from "bun";

/** Per-connection data attached at upgrade time. */
export interface WsData {
  teamId: string;
}
export type AppWebSocket = ServerWebSocket<WsData>;

/** Lifecycle/presence events broadcast to a team's connected clients. */
export type HubEvent =
  | { kind: "run"; action: "created" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled"; runId: string }
  | { kind: "run.progress"; runId: string; completedSteps: number; stepCount: number }
  | { kind: "chat.message"; sessionId: string; runId: string; role: "assistant" }
  | { kind: "presence" }
  | { kind: "control.ack"; runId: string; action: string; accepted: boolean; error?: string };

/**
 * Team-scoped WebSocket fan-out. The frontend opens one socket per team and
 * invalidates React Query caches on these events (multica-style realtime sync).
 */
class Hub {
  private conns = new Map<string, Set<AppWebSocket>>();

  add(teamId: string, ws: AppWebSocket): void {
    let set = this.conns.get(teamId);
    if (!set) {
      set = new Set();
      this.conns.set(teamId, set);
    }
    set.add(ws);
  }

  remove(teamId: string, ws: AppWebSocket): void {
    const set = this.conns.get(teamId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.conns.delete(teamId);
  }

  publish(teamId: string, event: HubEvent): void {
    const set = this.conns.get(teamId);
    if (!set || set.size === 0) return;
    const data = JSON.stringify(event);
    for (const ws of set) {
      try {
        ws.send(data);
      } catch {
        /* socket closing — dropped on next close event */
      }
    }
  }
}

export const hub = new Hub();
