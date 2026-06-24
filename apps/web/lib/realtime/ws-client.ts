"use client";

/**
 * Single team-scoped realtime socket to the engine (`/realtime?team=`). Carries
 * lifecycle + presence events (server→client) and ControlMessages (client→server).
 * One shared instance so `use-realtime-sync` and `run-control` ride the same wire.
 * No-op in mock mode (MSW on) — there is no engine to talk to.
 */

export type RealtimeEvent =
  | { kind: "run"; action: string; runId: string }
  | { kind: "run.progress"; runId: string; completedSteps: number; stepCount: number }
  | { kind: "chat.message"; sessionId: string; runId: string; role: string }
  | { kind: "presence" }
  | { kind: "control.ack"; runId: string; action: string; accepted: boolean; error?: string };

type Listener = (event: RealtimeEvent) => void;

// Real engine by default; mock is opt-in (NEXT_PUBLIC_USE_MOCK=true).
export const USE_MOCK =
  process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_MOCK === "true";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8787";

class RealtimeClient {
  private ws: WebSocket | null = null;
  private team: string | null = null;
  private listeners = new Set<Listener>();
  private attempts = 0;
  private closedByUs = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(team: string): void {
    if (USE_MOCK || typeof window === "undefined") return;
    if (this.team === team && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.team = team;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (!this.team) return;
    const url = `${ENGINE_URL.replace(/^http/, "ws")}/realtime?team=${encodeURIComponent(this.team)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
    };
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as RealtimeEvent;
        for (const l of this.listeners) l(event);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.closedByUs) return;
      const delay = Math.min(10_000, 500 * 2 ** this.attempts) + Math.random() * 300;
      this.attempts += 1;
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
}

export const realtime = new RealtimeClient();
