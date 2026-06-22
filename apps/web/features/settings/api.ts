"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { ProvidersResponse } from "./types";

// ── Providers ────────────────────────────────────────────────────────────────
export function useProviders(team: string) {
  return useQuery({
    queryKey: qk.settings.providers(team),
    queryFn: ({ signal }) => apiFetch<ProvidersResponse>("/settings/providers", { team, signal }),
  });
}

export function useUpdateProvider(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: "active" | "off"; isDefault?: boolean }) =>
      apiFetch(`/settings/providers/${id}`, { method: "PATCH", team, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings.providers(team) }),
  });
}

export function useTestProvider(team: string) {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; latencyMs?: number; message?: string }>(`/settings/providers/${id}/test`, {
        method: "POST",
        team,
      }),
  });
}
