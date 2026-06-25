"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/queryKeys";
import { realtime } from "./ws-client";

/**
 * multica-style realtime sync: one socket per team, events only invalidate React
 * Query caches (never write stores directly). Invalidations are debounced per
 * bucket so a burst of deltas triggers at most one refetch each.
 */
export function useRealtimeSync(team: string) {
  const qc = useQueryClient();

  useEffect(() => {
    realtime.connect(team);

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const debounce = (key: string, fn: () => void) => {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(key, setTimeout(fn, 120));
    };

    const invalidateRuns = () =>
      qc.invalidateQueries({ queryKey: qk.runs.all(team) });
    const invalidateAgents = () =>
      qc.invalidateQueries({ queryKey: qk.agents.all(team) });
    const invalidateSystem = () =>
      qc.invalidateQueries({ queryKey: qk.settings.system(team) });

    const unsub = realtime.subscribe((event) => {
      switch (event.kind) {
        case "run":
        case "run.progress":
          debounce("runs", invalidateRuns);
          debounce("agents", invalidateAgents); // presence/workload derives from runs
          break;
        case "presence":
          debounce("agents", invalidateAgents);
          debounce("system", invalidateSystem);
          break;
        default:
          break;
      }
    });

    return () => {
      unsub();
      for (const t of timers.values()) clearTimeout(t);
    };
  }, [team, qc]);
}
