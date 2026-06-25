"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

export interface DaemonEligibleOrg {
  teamId: string;
  slug: string;
  name: string;
}

export interface DaemonTokenStatus {
  hasToken: boolean;
  prefix: string | null;
  issuedAt: string | null;
  eligibleOrgs: DaemonEligibleOrg[];
}

export interface RotatedDaemonToken extends DaemonTokenStatus {
  token: string;
}

const daemonTokenKey = (team: string) => ["team", team, "daemon-token"] as const;

/** The signed-in user's personal daemon token status. The token value is never returned here. */
export function useDaemonToken(team: string) {
  return useQuery({
    queryKey: daemonTokenKey(team),
    queryFn: ({ signal }) => apiFetch<DaemonTokenStatus>("/me/daemon-token", { team, signal }),
    staleTime: 60_000,
  });
}

export function useRotateDaemonToken(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<RotatedDaemonToken>("/me/daemon-token/rotate", { method: "POST", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: daemonTokenKey(team) }),
  });
}

export function useRevokeDaemonToken(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: true }>("/me/daemon-token", { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: daemonTokenKey(team) }),
  });
}
