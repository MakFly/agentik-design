"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import type {
  ProjectDetail,
  ProjectResource,
  ProjectResourceType,
  ProjectSummary,
  ProjectTask,
  ProjectTaskComment,
  ProjectTaskPriority,
  ProjectTaskStatus,
  ProjectType,
} from "./types";

export function useProjects(team: string) {
  return useQuery({
    queryKey: qk.projects.list(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: ProjectSummary[]; total: number }>("/projects", {
        team,
        signal,
      }),
  });
}

export function useProject(team: string, projectId: string) {
  return useQuery({
    queryKey: qk.projects.detail(team, projectId),
    queryFn: ({ signal }) =>
      apiFetch<ProjectDetail>(`/projects/${projectId}`, { team, signal }),
  });
}

export function useCreateProject(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      type: ProjectType;
      description?: string;
      leadAgentId?: string | null;
    }) =>
      apiFetch<ProjectSummary>("/projects", {
        method: "POST",
        team,
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects.all(team) }),
  });
}

export function useAddProjectResource(team: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      type: ProjectResourceType;
      ref: string;
      label?: string;
    }) =>
      apiFetch<ProjectResource>(`/projects/${projectId}/resources`, {
        method: "POST",
        team,
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.projects.detail(team, projectId) }),
  });
}

export function useCreateProjectTask(team: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      description?: string;
      priority?: ProjectTaskPriority;
      assignedAgentId?: string | null;
    }) =>
      apiFetch<ProjectTask>(`/projects/${projectId}/tasks`, {
        method: "POST",
        team,
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.projects.detail(team, projectId) }),
  });
}

export function useUpdateProjectTask(team: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      ...body
    }: {
      taskId: string;
      status?: ProjectTaskStatus;
      assignedAgentId?: string | null;
      title?: string;
      description?: string;
      priority?: ProjectTaskPriority;
    }) =>
      apiFetch<ProjectTask>(`/project-tasks/${taskId}`, {
        method: "PATCH",
        team,
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.projects.detail(team, projectId) }),
  });
}

export function useRunProjectTask(team: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      instruction,
    }: {
      taskId: string;
      instruction?: string;
    }) =>
      apiFetch<{ runId: string }>(`/project-tasks/${taskId}/run`, {
        method: "POST",
        team,
        body: { instruction },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.projects.detail(team, projectId) });
      qc.invalidateQueries({ queryKey: qk.runs.all(team) });
    },
  });
}

export function useProjectTaskComments(team: string, taskId: string | null) {
  return useQuery({
    queryKey: taskId ? qk.projects.taskComments(team, taskId) : ["team", team, "projects", "task", "none", "comments"],
    enabled: Boolean(taskId),
    queryFn: ({ signal }) =>
      apiFetch<{ items: ProjectTaskComment[]; total: number }>(
        `/project-tasks/${taskId}/comments`,
        { team, signal },
      ),
  });
}

export function useAddProjectTaskComment(team: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, content }: { taskId: string; content: string }) =>
      apiFetch<ProjectTaskComment>(`/project-tasks/${taskId}/comments`, {
        method: "POST",
        team,
        body: { content },
      }),
    onSuccess: (_comment, vars) => {
      qc.invalidateQueries({ queryKey: qk.projects.detail(team, projectId) });
      qc.invalidateQueries({ queryKey: qk.projects.taskComments(team, vars.taskId) });
    },
  });
}
