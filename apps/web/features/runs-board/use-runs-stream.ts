"use client";

import { useCallback, useMemo, useState } from "react";
import { useRuns } from "@/features/run-view/api";
import type { Run, RunStatus } from "@/types/domain";

export type StreamStatus = "connecting" | "live" | "error";

/**
 * Board data source. Backed by the `/runs` query (engine in real mode, MSW in
 * mock mode); live freshness comes from `useRealtimeSync` invalidating this query
 * on WebSocket lifecycle events — no per-board socket. `applyLocalMove` lets a
 * manual drag optimistically override a card's lane until the next refetch.
 */
export function useRunsStream(team: string) {
  const { data, isLoading, isError } = useRuns(team);
  const [overrides, setOverrides] = useState<Map<string, RunStatus>>(() => new Map());

  const runs = useMemo(() => {
    const map = new Map<string, Run>();
    for (const r of data?.items ?? []) {
      const ov = overrides.get(r.id);
      map.set(r.id, ov && ov !== r.status ? { ...r, status: ov } : r);
    }
    return map;
  }, [data, overrides]);

  const status: StreamStatus = isError ? "error" : isLoading ? "connecting" : "live";

  const applyLocalMove = useCallback((id: string, nextStatus: RunStatus) => {
    setOverrides((prev) => new Map(prev).set(id, nextStatus));
  }, []);

  return { runs, status, applyLocalMove };
}
