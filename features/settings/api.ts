"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, qs } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { Role } from "@/config/permissions";
import type {
  ApiKey,
  ApiKeyCreated,
  ApiKeyScope,
  ProvidersResponse,
  TeamResponse,
  Billing,
  SecurityPolicy,
  AuditResponse,
} from "./types";

const idem = () => ({ "idempotency-key": crypto.randomUUID() });

// ── API keys ───────────────────────────────────────────────────────────────
export function useApiKeys(team: string) {
  return useQuery({
    queryKey: qk.settings.apiKeys(team),
    queryFn: ({ signal }) => apiFetch<{ items: ApiKey[] }>("/settings/api-keys", { team, signal }),
  });
}

export function useCreateApiKey(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; scopes: ApiKeyScope[] }) =>
      apiFetch<ApiKeyCreated>("/settings/api-keys", { method: "POST", team, body, headers: idem() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings.apiKeys(team) }),
  });
}

export function useRevokeApiKey(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/settings/api-keys/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings.apiKeys(team) }),
  });
}

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

// ── Team / members ───────────────────────────────────────────────────────────
export function useMembers(team: string) {
  return useQuery({
    queryKey: qk.settings.members(team),
    queryFn: ({ signal }) => apiFetch<TeamResponse>("/settings/members", { team, signal }),
  });
}

export function useInviteMember(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: Role }) =>
      apiFetch("/settings/members", { method: "POST", team, body, headers: idem() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings.members(team) }),
  });
}

export function useUpdateMemberRole(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      apiFetch(`/settings/members/${id}`, { method: "PATCH", team, body: { role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings.members(team) }),
  });
}

export function useRemoveMember(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/settings/members/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings.members(team) }),
  });
}

// ── Billing ────────────────────────────────────────────────────────────────
export function useBilling(team: string) {
  return useQuery({
    queryKey: qk.settings.billing(team),
    queryFn: ({ signal }) => apiFetch<Billing>("/settings/billing", { team, signal }),
  });
}

// ── Security ─────────────────────────────────────────────────────────────────
export function useSecurity(team: string) {
  return useQuery({
    queryKey: qk.settings.security(team),
    queryFn: ({ signal }) => apiFetch<SecurityPolicy>("/settings/security", { team, signal }),
  });
}

export function useUpdateSecurity(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SecurityPolicy>) =>
      apiFetch<SecurityPolicy>("/settings/security", { method: "PATCH", team, body: patch }),
    onSuccess: (data) => qc.setQueryData(qk.settings.security(team), data),
  });
}

// ── Audit log ────────────────────────────────────────────────────────────────
export function useAuditLog(team: string, filters: { q?: string; suspicious?: boolean } = {}) {
  return useQuery({
    queryKey: qk.settings.audit(team, filters),
    queryFn: ({ signal }) => apiFetch<AuditResponse>(`/settings/audit${qs(filters)}`, { team, signal }),
  });
}
