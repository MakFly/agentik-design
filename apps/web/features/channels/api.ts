"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { ChannelConnection } from "./types";

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
