"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, qs } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";

export type MemoryScope = "team" | "project" | "agent" | "workflow";
export type MemoryCreatedBy = "user" | "system" | "review_agent";

export interface MemoryEntry {
  id: string;
  teamId: string;
  scope: MemoryScope;
  targetId: string | null;
  content: string;
  sourceRunId: string | null;
  confidence: number;
  createdBy: MemoryCreatedBy;
  lastEditedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFilters {
  q?: string;
  scope?: MemoryScope | "all";
  targetId?: string;
  createdBy?: MemoryCreatedBy | "all";
  includeArchived?: boolean;
}

export interface MemoryInput {
  scope: MemoryScope;
  targetId?: string | null;
  content: string;
  confidence?: number;
}

export interface MemoryEvent {
  id: string;
  teamId: string;
  memoryId: string;
  action: "create" | "update" | "archive" | "restore";
  actorId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface InjectionPreview {
  agent: { id: string; name: string };
  memoryPolicy: {
    inject: boolean;
    scopes: Array<"team" | "project" | "agent">;
    maxEntries: number;
    minConfidence: number;
  };
  skillPolicy: {
    inject: boolean;
    scopes: Array<"team" | "project" | "agent">;
    maxSkills: number;
  };
  memories: Array<{ content: string; confidence: number; scope: MemoryScope }>;
  skills: Array<{ name: string; bodyMd: string; triggerConditions: string[] }>;
}

export interface SessionRecallHit {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  taskId: string | null;
  createdAt: string;
  agentId: string | null;
  agentName: string | null;
  sessionTitle: string;
}

function apiFilters(filters: MemoryFilters) {
  return {
    ...filters,
    scope: filters.scope === "all" ? undefined : filters.scope,
    createdBy: filters.createdBy === "all" ? undefined : filters.createdBy,
    includeArchived: filters.includeArchived ? "true" : undefined,
  };
}

export function useMemoryEntries(team: string, filters: MemoryFilters) {
  return useQuery({
    queryKey: qk.memory.list(team, filters),
    queryFn: ({ signal }) =>
      apiFetch<{ items: MemoryEntry[]; total: number }>(
        `/memory${qs(apiFilters(filters))}`,
        { team, signal },
      ),
  });
}

export function useCreateMemory(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MemoryInput) =>
      apiFetch<MemoryEntry>("/memory", { method: "POST", team, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memory.all(team) }),
  });
}

export function useUpdateMemory(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<MemoryInput> & { id: string }) =>
      apiFetch<MemoryEntry>(`/memory/${id}`, { method: "PATCH", team, body }),
    onSuccess: (_memory, vars) => {
      qc.invalidateQueries({ queryKey: qk.memory.all(team) });
      qc.invalidateQueries({ queryKey: qk.memory.detail(team, vars.id) });
    },
  });
}

export function useArchiveMemory(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<MemoryEntry>(`/memory/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memory.all(team) }),
  });
}

export function useRestoreMemory(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<MemoryEntry>(`/memory/${id}/restore`, { method: "POST", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memory.all(team) }),
  });
}

export function useMemoryEvents(team: string, memoryId?: string) {
  return useQuery({
    queryKey: qk.memory.events(team, memoryId),
    queryFn: ({ signal }) =>
      apiFetch<{ items: MemoryEvent[]; total: number }>(
        `/memory/events${qs({ memoryId })}`,
        { team, signal },
      ),
  });
}

export function useInjectionPreview(team: string, agentId?: string) {
  return useQuery({
    queryKey: qk.memory.preview(team, agentId),
    enabled: Boolean(agentId),
    queryFn: ({ signal }) =>
      apiFetch<InjectionPreview>(
        `/memory/injection-preview${qs({ agentId })}`,
        { team, signal },
      ),
  });
}

export function useSessionRecall(team: string, q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.memory.search(team, query),
    enabled: query.length >= 2,
    queryFn: ({ signal }) =>
      apiFetch<{ items: SessionRecallHit[]; total: number }>(
        `/memory/session-search${qs({ q: query })}`,
        { team, signal },
      ),
  });
}
