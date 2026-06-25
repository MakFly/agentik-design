export type ProjectType = "ops" | "code" | "hybrid";
export type ProjectStatus = "active" | "archived";
export type ProjectResourceType = "git_repo" | "local_dir" | "url" | "document" | "tool";
export type ProjectTaskStatus = "backlog" | "ready" | "running" | "blocked" | "review" | "done" | "cancelled";
export type ProjectTaskPriority = "P0" | "P1" | "P2" | "P3";

export interface ProjectTaskCounts {
  backlog: number;
  ready: number;
  running: number;
  blocked: number;
  review: number;
  done: number;
  cancelled: number;
}

export interface ProjectSummary {
  id: string;
  teamId: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  description: string;
  leadAgentId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  taskCounts: ProjectTaskCounts;
  openTaskCount: number;
  resourceCount: number;
}

export interface ProjectResource {
  id: string;
  teamId: string;
  projectId: string;
  type: ProjectResourceType;
  label: string;
  ref: string;
  status: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  teamId: string;
  projectId: string;
  title: string;
  description: string;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  assignedAgentId: string | null;
  lastRunId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkspace {
  id: string;
  teamId: string;
  projectId: string;
  resourceId: string | null;
  daemonId: string | null;
  path: string;
  branch: string;
  status: string;
  error: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemory {
  id: string;
  teamId: string;
  scope: "team" | "project" | "agent" | "workflow";
  targetId: string | null;
  content: string;
  sourceRunId: string | null;
  confidence: number;
  createdBy: "user" | "system" | "review_agent";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail {
  project: ProjectSummary;
  resources: ProjectResource[];
  tasks: ProjectTask[];
  workspaces: ProjectWorkspace[];
  memories: ProjectMemory[];
}

export interface ProjectTaskComment {
  id: string;
  teamId: string;
  projectTaskId: string;
  authorKind: "user" | "agent" | "system";
  userId: string | null;
  agentId: string | null;
  content: string;
  runId: string | null;
  createdAt: string;
}

export interface RunProjectContextProject {
  id: string;
  teamId: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  description: string;
  leadAgentId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunProjectContext {
  project: RunProjectContextProject;
  task: ProjectTask;
  resources: ProjectResource[];
  workspaces: ProjectWorkspace[];
}
