import { create } from "zustand";
import type { RunEvent } from "@/types/events";
import {
  runStreamReducer,
  emptyRunStreamState,
  type RunStreamState,
  type ConnectionState,
} from "@/lib/realtime/event-reducer";
import type { Step } from "@/types/domain";

/**
 * High-frequency stream buffers, keyed by runId (docs/03 §7.3). The SSE handler
 * writes here; components subscribe with narrow selectors so a token delta
 * re-renders only the focused step, not the whole timeline.
 */
interface RunStreamStore {
  byRun: Record<string, RunStreamState>;
  /** seed a run's buffer from the REST snapshot before the stream attaches */
  seed: (runId: string, partial: Partial<RunStreamState>) => void;
  applyEvent: (runId: string, event: RunEvent, ts?: string, eventId?: string) => void;
  setConnection: (runId: string, connection: ConnectionState) => void;
  reset: (runId: string) => void;
}

export const useRunStreamStore = create<RunStreamStore>((set) => ({
  byRun: {},

  seed: (runId, partial) =>
    set((s) => ({
      byRun: { ...s.byRun, [runId]: { ...emptyRunStreamState, ...s.byRun[runId], ...partial } },
    })),

  applyEvent: (runId, event, ts, eventId) =>
    set((s) => {
      const prev = s.byRun[runId] ?? emptyRunStreamState;
      const next = runStreamReducer(prev, event, ts);
      return { byRun: { ...s.byRun, [runId]: { ...next, lastEventId: eventId ?? next.lastEventId } } };
    }),

  setConnection: (runId, connection) =>
    set((s) => {
      const prev = s.byRun[runId] ?? emptyRunStreamState;
      return { byRun: { ...s.byRun, [runId]: { ...prev, connection } } };
    }),

  reset: (runId) =>
    set((s) => {
      const next = { ...s.byRun };
      delete next[runId];
      return { byRun: next };
    }),
}));

/* ── Narrow selector hooks (subscribe to the smallest slice) ────────────── */

/** Stable empty reference so the selector doesn't return a new array each render
 * (which would make useSyncExternalStore loop — "getSnapshot should be cached"). */
const EMPTY_STEPS: Step[] = [];

export function useRunSteps(runId: string): Step[] {
  return useRunStreamStore((s) => s.byRun[runId]?.steps ?? EMPTY_STEPS);
}

export function useRunConnection(runId: string): ConnectionState {
  return useRunStreamStore((s) => s.byRun[runId]?.connection ?? "idle");
}

export function useStepReasoning(runId: string, stepId: string | null): string | undefined {
  return useRunStreamStore((s) => (stepId ? s.byRun[runId]?.reasoningByStep[stepId] : undefined));
}

export function useRunStreamState(runId: string): RunStreamState | undefined {
  return useRunStreamStore((s) => s.byRun[runId]);
}
