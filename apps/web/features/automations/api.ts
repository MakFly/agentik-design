"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, qs } from "@/lib/api/client";
import type { Delivery, Rule, Signal } from "./types";

/** Accept either `{ items }` envelopes or a bare array from the engine. */
function toArray<T>(res: { items?: T[] } | T[] | null | undefined): T[] {
  if (Array.isArray(res)) return res;
  return res?.items ?? [];
}

const signalsKey = (team: string) => ["team", team, "signals"] as const;
const rulesKey = (team: string, filters?: object) => ["team", team, "rules", filters ?? {}] as const;
const deliveriesKey = (team: string) => ["team", team, "deliveries"] as const;

/* ───────────────────────────── Signals ───────────────────────────── */

export function useSignals(team: string) {
  return useQuery({
    queryKey: signalsKey(team),
    queryFn: ({ signal }) => apiFetch<{ items?: Signal[] } | Signal[]>("/signals", { team, signal }),
    select: toArray<Signal>,
  });
}

export interface SignalInput {
  name: string;
  kind: string;
  source?: string;
  status?: string;
  config?: Record<string, unknown> | null;
}

export function useCreateSignal(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SignalInput) => apiFetch<Signal>("/signals", { method: "POST", team, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: signalsKey(team) }),
  });
}

export function useUpdateSignal(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SignalInput> }) =>
      apiFetch<Signal>(`/signals/${id}`, { method: "PATCH", team, body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: signalsKey(team) }),
  });
}

export function useDeleteSignal(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/signals/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: signalsKey(team) }),
  });
}

export function useDispatchSignal(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) =>
      apiFetch<{ ok: boolean }>(`/signals/${id}/dispatch`, { method: "POST", team, body: { payload } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: deliveriesKey(team) }),
  });
}

/* ────────────────────────────── Rules ────────────────────────────── */

export function useRules(team: string, filters: { agentId?: string } = {}) {
  return useQuery({
    queryKey: rulesKey(team, filters),
    queryFn: ({ signal }) =>
      apiFetch<{ items?: Rule[] } | Rule[]>(`/rules${qs(filters)}`, { team, signal }),
    select: toArray<Rule>,
  });
}

export interface RuleInput {
  name: string;
  status?: string;
  signalId?: string | null;
  condition?: Rule["condition"];
  action: Rule["action"];
  targetAgentId?: string | null;
}

export function useCreateRule(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RuleInput) => apiFetch<Rule>("/rules", { method: "POST", team, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", team, "rules"] }),
  });
}

export function useUpdateRule(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<RuleInput> }) =>
      apiFetch<Rule>(`/rules/${id}`, { method: "PATCH", team, body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", team, "rules"] }),
  });
}

export function useDeleteRule(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/rules/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", team, "rules"] }),
  });
}

/* ──────────────────────────── Deliveries ─────────────────────────── */

export function useDeliveries(team: string) {
  return useQuery({
    queryKey: deliveriesKey(team),
    queryFn: ({ signal }) => apiFetch<{ items?: Delivery[]; total?: number } | Delivery[]>("/deliveries", { team, signal }),
    select: toArray<Delivery>,
  });
}
