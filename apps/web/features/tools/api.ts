"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type { McpServer, McpTransport, ToolCatalogItem } from "@/types/domain";

interface ListResponse<T> {
  items: T[];
  total?: number;
  nextCursor?: string | null;
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  url: string;
  credentialId?: string | null;
}

export function useMcpServers(team: string) {
  return useQuery({
    queryKey: qk.tools.list(team, { source: "mcp" }),
    queryFn: ({ signal }) =>
      apiFetch<ListResponse<McpServer>>("/mcp-servers", { team, signal }),
    select: (data) => data.items,
  });
}

export function useCreateMcpServer(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: McpServerInput) =>
      apiFetch<McpServer>("/mcp-servers", {
        method: "POST",
        team,
        body,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tools.all(team) }),
  });
}

export function useUpdateMcpServer(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<McpServerInput> & { id: string }) =>
      apiFetch<McpServer>(`/mcp-servers/${id}`, {
        method: "PATCH",
        team,
        body,
      }),
    onSuccess: (_server, vars) => {
      qc.invalidateQueries({ queryKey: qk.tools.all(team) });
      qc.invalidateQueries({ queryKey: qk.tools.detail(team, vars.id) });
    },
  });
}

export function useDeleteMcpServer(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/mcp-servers/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tools.all(team) }),
  });
}

export function useTestMcpServer(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true; toolCount: number } | { ok: false; error: string }>(
        `/mcp-servers/${id}/test`,
        { method: "POST", team },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tools.all(team) }),
  });
}

export function useSyncMcpServer(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<McpServer | { error: string }>(`/mcp-servers/${id}/sync`, {
        method: "POST",
        team,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tools.all(team) }),
  });
}

export function useToolCatalog(team: string) {
  return useQuery({
    queryKey: qk.tools.catalog(team),
    queryFn: ({ signal }) =>
      apiFetch<ListResponse<ToolCatalogItem>>("/tools/catalog", {
        team,
        signal,
      }),
    select: (data) => data.items,
  });
}
