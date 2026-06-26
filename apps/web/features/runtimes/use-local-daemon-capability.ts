"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import type { LocalDaemonCapability, LocalDaemonStatus } from "./types";

/** Detect whether the web server can orchestrate a local daemon install on this machine. */
export function useLocalDaemonCapability() {
  const query = useQuery({
    queryKey: ["local-daemon-capability"],
    queryFn: async ({ signal }) => {
      try {
        const status = await apiFetch<LocalDaemonStatus>("/local/daemon", {
          signal,
        });
        if (status.orchestratorAvailable === false) {
          return "hosted" satisfies LocalDaemonCapability;
        }
        return "local_available" satisfies LocalDaemonCapability;
      } catch {
        return "hosted" satisfies LocalDaemonCapability;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  return {
    capability: (query.data ?? "checking") as LocalDaemonCapability,
    isLoading: query.isLoading,
  };
}
