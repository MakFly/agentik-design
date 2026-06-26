"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { DEFAULT_ENGINE_URL, PERSONAL_RUNTIMES } from "./constants";
import type { InstallEvent, LocalDaemonStatus } from "./types";

interface LocalDaemonJob {
  jobId: string;
}

export function useLocalDaemonStatus() {
  return useQuery({
    queryKey: ["local-daemon"],
    queryFn: ({ signal }) =>
      apiFetch<LocalDaemonStatus>("/local/daemon", { signal }),
    refetchInterval: 3000,
  });
}

export function useCreateLocalDaemonJob(team: string) {
  return useMutation({
    mutationFn: (input: { token: string }) =>
      apiFetch<LocalDaemonJob>("/local/daemon/jobs", {
        method: "POST",
        team,
        body: {
          token: input.token,
          engineUrl: DEFAULT_ENGINE_URL,
          runtimes: PERSONAL_RUNTIMES,
          team,
        },
      }),
  });
}

export function useControlLocalDaemon(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "stop") =>
      apiFetch<LocalDaemonStatus>("/local/daemon", {
        method: "POST",
        team,
        body: { action },
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["local-daemon"] });
      qc.invalidateQueries({ queryKey: qk.settings.system(team) });
    },
  });
}

export function useUninstallLocalDaemon(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<LocalDaemonStatus>("/local/daemon", {
        method: "DELETE",
        team,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["local-daemon"] });
      qc.invalidateQueries({ queryKey: qk.settings.system(team) });
    },
  });
}

export function streamInstallJob(
  jobId: string,
  onEvent: (event: InstallEvent) => void,
): Promise<InstallEvent> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/v1/local/daemon/jobs/${jobId}/events`);
    const finish = (event: InstallEvent) => {
      es.close();
      if (event.phase === "failed") {
        reject(new Error(event.message));
        return;
      }
      resolve(event);
    };
    const handle = (raw: MessageEvent) => {
      const event = JSON.parse(raw.data) as InstallEvent;
      onEvent(event);
      if (event.terminal) finish(event);
    };
    for (const type of [
      "started",
      "log",
      "status",
      "daemon.running",
      "completed",
      "failed",
    ]) {
      es.addEventListener(type, handle);
    }
    es.onerror = () => {
      es.close();
      reject(
        new Error(
          "Install stream unavailable. The local daemon route may not be registered yet.",
        ),
      );
    };
  });
}
