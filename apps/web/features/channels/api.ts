"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { ChannelConnection } from "./types";
import type { Binding, GroupPolicy } from "@/features/automations/types";

export function useChannels(team: string) {
  return useQuery({
    queryKey: qk.channels.list(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: ChannelConnection[]; total: number }>("/channels", {
        team,
        signal,
      }),
  });
}

export function useCreateTelegramConnection(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label?: string; botToken?: string }) =>
      apiFetch<ChannelConnection>("/channels/telegram", {
        method: "POST",
        team,
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.channels.all(team) }),
  });
}

export function useDeleteChannel(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/channels/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.channels.all(team) }),
  });
}

export function useRegisterChannelWebhook(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, baseUrl }: { id: string; baseUrl?: string }) =>
      apiFetch<{ ok: boolean; url?: string; botUsername?: string; error?: string }>(
        `/channels/${id}/webhook`,
        { method: "POST", team, body: { baseUrl } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.channels.all(team) }),
  });
}

export function useUseChannelPolling(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; botUsername?: string; error?: string }>(`/channels/${id}/polling`, {
        method: "POST",
        team,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.channels.all(team) }),
  });
}

/* ──────────────────── Per-agent channel bindings ─────────────────── */

const bindingsKey = (team: string, channelId: string) =>
  ["team", team, "channels", channelId, "bindings"] as const;

export function useChannelBindings(team: string, channelId: string) {
  return useQuery({
    queryKey: bindingsKey(team, channelId),
    queryFn: ({ signal }) =>
      apiFetch<{ items?: Binding[] } | Binding[]>(`/channels/${channelId}/bindings`, { team, signal }),
    select: (res) => (Array.isArray(res) ? res : (res?.items ?? [])),
  });
}

export interface CreateBindingInput {
  agentId?: string;
  groupPolicy: GroupPolicy;
  requireMention: boolean;
  config?: Record<string, unknown> | null;
}

export function useCreateBinding(team: string, channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBindingInput) =>
      apiFetch<Binding>(`/channels/${channelId}/bindings`, { method: "POST", team, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: bindingsKey(team, channelId) }),
  });
}

export function useUpdateBinding(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bindingId, patch }: { bindingId: string; patch: Partial<CreateBindingInput> }) =>
      apiFetch<Binding>(`/channels/bindings/${bindingId}`, { method: "PATCH", team, body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", team, "channels"] }),
  });
}

export function useDeleteBinding(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bindingId: string) =>
      apiFetch<{ ok: true }>(`/channels/bindings/${bindingId}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", team, "channels"] }),
  });
}
