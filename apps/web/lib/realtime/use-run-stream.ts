"use client";

import { useEffect, useRef } from "react";
import { useRunStreamStore } from "@/lib/stores/runStream.store";
import type { EventEnvelope, RunEvent, RunEventType } from "@/types/events";

const STREAM_EVENTS: RunEventType[] = [
  "run.status.changed",
  "run.cost.updated",
  "step.started",
  "step.completed",
  "step.failed",
  "step.retrying",
  "reasoning.delta",
  "tool_call.started",
  "tool_call.completed",
  "approval.requested",
  "approval.resolved",
  "log.line",
  "stream.error",
];

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export interface UseRunStreamOpts {
  /** only attach for live runs; completed runs read the static snapshot */
  enabled: boolean;
}

/**
 * Subscribes to a run's SSE stream (docs/03 §7.5). Dispatches typed events into
 * the runStream store. Coalesces high-frequency deltas on requestAnimationFrame
 * to cap re-renders, and reconnects with backoff + Last-Event-ID gap recovery.
 */
export function useRunStream(runId: string, { enabled }: UseRunStreamOpts) {
  const applyEvent = useRunStreamStore((s) => s.applyEvent);
  const setConnection = useRunStreamStore((s) => s.setConnection);

  // queue of (event, ts, id) flushed once per animation frame
  const queue = useRef<Array<{ event: RunEvent; ts?: string; id?: string }>>([]);
  const rafId = useRef<number | null>(null);
  const attempts = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const closedByUs = useRef(false);

  useEffect(() => {
    if (!enabled || !runId) return;
    closedByUs.current = false;

    function flush() {
      rafId.current = null;
      const batch = queue.current;
      queue.current = [];
      for (const { event, ts, id } of batch) applyEvent(runId, event, ts, id);
    }

    function enqueue(env: EventEnvelope) {
      queue.current.push({ event: env.data, ts: env.ts, id: env.id });
      if (rafId.current == null) rafId.current = requestAnimationFrame(flush);
    }

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const last = useRunStreamStore.getState().byRun[runId]?.lastEventId;
      const url = `/api/v1/runs/${runId}/stream${last ? `?lastEventId=${encodeURIComponent(last)}` : ""}`;
      setConnection(runId, attempts.current === 0 ? "connecting" : "reconnecting");

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        attempts.current = 0;
        setConnection(runId, "open");
      };

      for (const type of STREAM_EVENTS) {
        es.addEventListener(type, (e) => {
          try {
            const env = JSON.parse((e as MessageEvent).data) as EventEnvelope;
            env.id = (e as MessageEvent).lastEventId || env.id;
            enqueue(env);
            if (env.data.type === "run.status.changed" && TERMINAL.has(env.data.status)) {
              closedByUs.current = true;
              es.close();
              setConnection(runId, "closed");
            }
          } catch {
            /* ignore malformed frame */
          }
        });
      }

      es.onerror = () => {
        es.close();
        if (closedByUs.current) return;
        // exponential backoff with jitter, capped at 10s
        const delay = Math.min(10_000, 500 * 2 ** attempts.current) + Math.random() * 300;
        attempts.current += 1;
        setConnection(runId, "reconnecting");
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      closedByUs.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      esRef.current?.close();
      setConnection(runId, "closed");
    };
  }, [runId, enabled, applyEvent, setConnection]);
}
