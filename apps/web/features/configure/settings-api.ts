"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { normalizeResponse } from "@/lib/api/errors";
import { qk } from "@/lib/api/queryKeys";
import type { Role } from "@/config/permissions";
import type { EnvironmentSettings, ManagedEnvironment } from "@/types/domain";

export type UiPreferences = {
  reduceMotion?: boolean;
  submitMode?: "enter" | "ctrlEnter";
  theme?: "light" | "dark" | "system";
};

export type NotificationPreferences = {
  emailRunComplete?: boolean;
  emailRunFailed?: boolean;
  emailApprovalNeeded?: boolean;
  emailInvitations?: boolean;
  inAppRuns?: boolean;
  inAppApprovals?: boolean;
  inAppMentions?: boolean;
};

export interface WorkspaceSettings {
  id: string;
  slug: string;
  name: string;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

const accountKey = ["account", "settings"] as const;
const workspaceKey = (team: string) =>
  ["team", team, "settings", "workspace"] as const;
const membersKey = (team: string) =>
  ["team", team, "settings", "members"] as const;
const invitationsKey = (team: string) =>
  ["team", team, "settings", "invitations"] as const;

async function patchAuth<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1/auth/${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await normalizeResponse(res);
  return res.json() as Promise<T>;
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name?: string;
      currentPassword?: string;
      newPassword?: string;
    }) =>
      patchAuth<{ ok: boolean; user: { name: string; email: string } }>(
        "me",
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKey }),
  });
}

export function useUpdateUiPreferences() {
  return useMutation({
    mutationFn: (body: UiPreferences) =>
      patchAuth<{ uiPreferences: UiPreferences }>("me/preferences", body),
  });
}

export function useUpdateNotificationPreferences() {
  return useMutation({
    mutationFn: (body: NotificationPreferences) =>
      patchAuth<{ notificationPreferences: NotificationPreferences }>(
        "me/notifications",
        body,
      ),
  });
}

export function useWorkspaceSettings(team: string) {
  return useQuery({
    queryKey: workspaceKey(team),
    queryFn: ({ signal }) =>
      apiFetch<WorkspaceSettings>("/settings/workspace", { team, signal }),
  });
}

export function useUpdateWorkspace(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; slug?: string }) =>
      apiFetch<WorkspaceSettings>("/settings/workspace", {
        method: "PATCH",
        team,
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKey(team) }),
  });
}

export function useEnvironmentSettings(team: string) {
  return useQuery({
    queryKey: qk.settings.environments(team),
    queryFn: ({ signal }) =>
      apiFetch<EnvironmentSettings>("/settings/environments", {
        team,
        signal,
      }),
  });
}

export function useUpdateEnvironmentSettings(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { items: ManagedEnvironment[]; activeId: string }) =>
      apiFetch<EnvironmentSettings>("/settings/environments", {
        method: "PATCH",
        team,
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings.environments(team) });
    },
  });
}

export function useTeamMembers(team: string) {
  return useQuery({
    queryKey: membersKey(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: TeamMember[] }>("/settings/members", { team, signal }),
  });
}

export function useUpdateMemberRole(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      apiFetch(`/settings/members/${userId}`, {
        method: "PATCH",
        team,
        body: { role },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(team) }),
  });
}

export function useRemoveMember(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/settings/members/${userId}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(team) }),
  });
}

export function useTeamInvitations(team: string) {
  return useQuery({
    queryKey: invitationsKey(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: TeamInvitation[] }>("/settings/invitations", {
        team,
        signal,
      }),
  });
}

export function useInviteMember(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: Role }) =>
      apiFetch<{ id: string; expiresAt: string; acceptUrl: string }>(
        "/settings/invitations",
        { method: "POST", team, body },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey(team) }),
  });
}

export function useRevokeInvitation(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/settings/invitations/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey(team) }),
  });
}

export function useUpdateProvidersPolicy(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      costCeilingPerDayCents?: number;
      fallbackOrder?: string[];
    }) =>
      apiFetch("/settings/providers-policy", { method: "PATCH", team, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings.providers(team) });
    },
  });
}
