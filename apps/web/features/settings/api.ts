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

// ── Provider keys ──────────────────────────────────────────────────────────────
// The org's encrypted API keys, one per provider family. The matching provider
// card (`/settings/providers`) derives its `hasKey` from this same data, so saving
// or removing a key invalidates both queries to keep the merged card in sync.
export interface ProviderKey {
  provider: string;
  envVar: string;
  hasKey: boolean;
  updatedAt: string | null;
}

const providerKeysKey = (team: string) =>
  ["team", team, "provider-keys"] as const;

export function useProviderKeys(team: string) {
  return useQuery({
    queryKey: providerKeysKey(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: ProviderKey[] }>("/settings/provider-keys", { team, signal }),
  });
}

function useInvalidateProviderState(team: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: providerKeysKey(team) }),
      qc.invalidateQueries({ queryKey: qk.settings.providers(team) }),
    ]);
}

export function useSetProviderKey(team: string) {
  const invalidate = useInvalidateProviderState(team);
  return useMutation({
    mutationFn: ({ provider, key }: { provider: string; key: string }) =>
      apiFetch(`/settings/provider-keys/${provider}`, { method: "PUT", team, body: { key } }),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveProviderKey(team: string) {
  const invalidate = useInvalidateProviderState(team);
  return useMutation({
    mutationFn: (provider: string) =>
      apiFetch(`/settings/provider-keys/${provider}`, { method: "DELETE", team }),
    onSuccess: () => invalidate(),
  });
}
