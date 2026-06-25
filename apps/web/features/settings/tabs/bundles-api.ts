"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

export type BundleAction = "install" | "upgrade" | "uninstall";
export type BundleStatus = "queued" | "running" | "done" | "failed";

export interface BundleCommand {
  id: string;
  daemonId: string;
  kind: string;
  action: BundleAction;
  status: BundleStatus;
  result: string | null;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface BundlesData {
  policy: { networkInstall: boolean };
  items: BundleCommand[];
}

const bundlesKey = (team: string) => ["team", team, "bundles"] as const;

export function useBundles(team: string) {
  return useQuery({
    queryKey: bundlesKey(team),
    queryFn: ({ signal }) => apiFetch<BundlesData>("/bundles", { team, signal }),
    refetchInterval: 4000, // installs run async on the daemon — keep the view live
  });
}

export function useSetBundlePolicy(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (networkInstall: boolean) =>
      apiFetch("/bundles/policy", { method: "PUT", team, body: { networkInstall } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: bundlesKey(team) }),
  });
}

export function useRunBundle(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { daemonId: string; kind: string; action: BundleAction }) =>
      apiFetch("/bundles", { method: "POST", team, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: bundlesKey(team) }),
  });
}
