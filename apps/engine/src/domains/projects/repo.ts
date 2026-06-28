import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { listMemory } from "../learning/memory/repo";
import type { ProjectResourceType, ProjectTaskPriority, ProjectTaskStatus, ProjectType } from "../../infra/db/schema";

const { projects, projectResources, projectTasks, projectTaskComments, projectWorkspaces, runs, agents } = schema;

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectTaskRow = typeof projectTasks.$inferSelect;
export type ProjectResourceRow = typeof projectResources.$inferSelect;

const PROJECT_TYPES: ProjectType[] = ["ops", "code", "hybrid"];
const RESOURCE_TYPES: ProjectResourceType[] = ["git_repo", "local_dir", "url", "document", "tool"];
const TASK_STATUSES: ProjectTaskStatus[] = ["backlog", "ready", "running", "blocked", "review", "done", "cancelled"];
const TASK_PRIORITIES: ProjectTaskPriority[] = ["P0", "P1", "P2", "P3"];

function projectType(value: unknown): ProjectType {
  return PROJECT_TYPES.includes(value as ProjectType) ? (value as ProjectType) : "hybrid";
}

function resourceType(value: unknown): ProjectResourceType | null {
  return RESOURCE_TYPES.includes(value as ProjectResourceType) ? (value as ProjectResourceType) : null;
}

function taskStatus(value: unknown): ProjectTaskStatus | undefined {
  return TASK_STATUSES.includes(value as ProjectTaskStatus) ? (value as ProjectTaskStatus) : undefined;
}

function taskPriority(value: unknown): ProjectTaskPriority {
  return TASK_PRIORITIES.includes(value as ProjectTaskPriority) ? (value as ProjectTaskPriority) : "P2";
}

function taskCounts(tasks: ProjectTaskRow[]) {
  return TASK_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: tasks.filter((task) => task.status === status).length }),
    {} as Record<ProjectTaskStatus, number>,
  );
}

function toProjectSummary(project: ProjectRow, tasks: ProjectTaskRow[], resources: ProjectResourceRow[]) {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  return {
    ...project,
    taskCounts: taskCounts(projectTasks),
    openTaskCount: projectTasks.filter((task) => !["done", "cancelled"].includes(task.status)).length,
    resourceCount: resources.filter((resource) => resource.projectId === project.id).length,
  };
}

export async function getProjectRow(teamId: string, projectId: string) {
  const [project] = await db.select().from(projects).where(and(eq(projects.teamId, teamId), eq(projects.id, projectId))).limit(1);
  return project ?? null;
}
const assertProject = getProjectRow;

export async function listProjects(teamId: string) {
  const [projectRows, taskRows, resourceRows] = await Promise.all([
    db.select().from(projects).where(eq(projects.teamId, teamId)).orderBy(desc(projects.updatedAt)),
    db.select().from(projectTasks).where(eq(projectTasks.teamId, teamId)),
    db.select().from(projectResources).where(eq(projectResources.teamId, teamId)),
  ]);
  return projectRows.map((project) => toProjectSummary(project, taskRows, resourceRows));
}

export async function createProject(
  teamId: string,
  createdBy: string,
  input: { name?: string; type?: unknown; description?: string; leadAgentId?: string | null },
) {
  const name = (input.name ?? "").trim();
  if (!name) return { error: "name_required" as const };
  const id = genId("proj");
  const [project] = await db
    .insert(projects)
    .values({
      id,
      teamId,
      name,
      type: projectType(input.type),
      description: input.description?.trim() ?? "",
      leadAgentId: input.leadAgentId || null,
      createdBy,
    })
    .returning();
  return { project: toProjectSummary(project!, [], []) };
}

export async function getProject(teamId: string, projectId: string) {
  const project = await assertProject(teamId, projectId);
  if (!project) return null;
  const [tasks, resources, workspaces, memories] = await Promise.all([
    db.select().from(projectTasks).where(and(eq(projectTasks.teamId, teamId), eq(projectTasks.projectId, projectId))).orderBy(desc(projectTasks.updatedAt)),
    db.select().from(projectResources).where(and(eq(projectResources.teamId, teamId), eq(projectResources.projectId, projectId))).orderBy(desc(projectResources.createdAt)),
    db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.teamId, teamId), eq(projectWorkspaces.projectId, projectId))).orderBy(desc(projectWorkspaces.updatedAt)),
    listMemory(teamId, { scope: "project", targetId: projectId }),
  ]);
  return { project: toProjectSummary(project, tasks, resources), tasks, resources, workspaces, memories };
}

export async function addProjectResource(
  teamId: string,
  projectId: string,
  input: { type?: unknown; ref?: string; label?: string; meta?: Record<string, unknown> },
) {
  const project = await assertProject(teamId, projectId);
  if (!project) return { error: "project_not_found" as const };
  const type = resourceType(input.type);
  const ref = (input.ref ?? "").trim();
  if (!type || !ref) return { error: "invalid_resource" as const };
  const [resource] = await db
    .insert(projectResources)
    .values({
      id: genId("pres"),
      teamId,
      projectId,
      type,
      ref,
      label: input.label?.trim() || ref,
      meta: input.meta ?? null,
    })
    .returning();
  await db.update(projects).set({ updatedAt: sql`now()` }).where(eq(projects.id, projectId));
  return { resource };
}

export async function createProjectTask(
  teamId: string,
  projectId: string,
  createdBy: string,
  input: { title?: string; description?: string; priority?: unknown; assignedAgentId?: string | null; status?: unknown },
) {
  const project = await assertProject(teamId, projectId);
  if (!project) return { error: "project_not_found" as const };
  const title = (input.title ?? "").trim();
  if (!title) return { error: "title_required" as const };
  const id = genId("ptask");
  const [task] = await db
    .insert(projectTasks)
    .values({
      id,
      teamId,
      projectId,
      title,
      description: input.description?.trim() ?? "",
      priority: taskPriority(input.priority),
      assignedAgentId: input.assignedAgentId || project.leadAgentId,
      status: taskStatus(input.status) ?? "ready",
      createdBy,
    })
    .returning();
  await db.update(projects).set({ updatedAt: sql`now()` }).where(eq(projects.id, projectId));
  return { task };
}

export async function updateProjectTask(
  teamId: string,
  runId: string,
  input: { status?: unknown; assignedAgentId?: string | null; title?: string; description?: string; priority?: unknown },
) {
  const [task] = await db.select().from(projectTasks).where(and(eq(projectTasks.teamId, teamId), eq(projectTasks.id, runId))).limit(1);
  if (!task) return null;
  const patch: Partial<typeof projectTasks.$inferInsert> = { updatedAt: sql`now()` as never };
  if (input.status !== undefined) patch.status = taskStatus(input.status) ?? task.status;
  if (input.assignedAgentId !== undefined) patch.assignedAgentId = input.assignedAgentId || null;
  if (input.title !== undefined && input.title.trim()) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.priority !== undefined) patch.priority = taskPriority(input.priority);
  const [updated] = await db.update(projectTasks).set(patch).where(and(eq(projectTasks.teamId, teamId), eq(projectTasks.id, runId))).returning();
  await db.update(projects).set({ updatedAt: sql`now()` }).where(eq(projects.id, task.projectId));
  return updated ?? null;
}

export async function listProjectTaskComments(teamId: string, runId: string) {
  return db
    .select()
    .from(projectTaskComments)
    .where(and(eq(projectTaskComments.teamId, teamId), eq(projectTaskComments.projectTaskId, runId)))
    .orderBy(projectTaskComments.createdAt);
}

export async function addProjectTaskComment(teamId: string, runId: string, userId: string, content: string) {
  const clean = content.trim();
  if (!clean) return { error: "content_required" as const };
  const [task] = await db.select().from(projectTasks).where(and(eq(projectTasks.teamId, teamId), eq(projectTasks.id, runId))).limit(1);
  if (!task) return { error: "task_not_found" as const };
  const [comment] = await db
    .insert(projectTaskComments)
    .values({ id: genId("pmsg"), teamId, projectTaskId: runId, authorKind: "user", userId, content: clean })
    .returning();
  await db.update(projectTasks).set({ updatedAt: sql`now()` }).where(eq(projectTasks.id, runId));
  return { comment };
}

// ── Data-access helpers for the run-orchestration service ──────────────────

export async function getProjectTaskRow(teamId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(projectTasks)
    .where(and(eq(projectTasks.teamId, teamId), eq(projectTasks.id, taskId)))
    .limit(1);
  return task ?? null;
}

export async function getRunnableAgent(teamId: string, agentId: string) {
  const [agent] = await db
    .select({ id: agents.id, liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  return agent ?? null;
}

export async function getProjectResources(teamId: string, projectId: string) {
  return db
    .select()
    .from(projectResources)
    .where(and(eq(projectResources.teamId, teamId), eq(projectResources.projectId, projectId)));
}

export async function getProjectMemories(teamId: string, projectId: string) {
  return listMemory(teamId, { scope: "project", targetId: projectId });
}

export async function createProjectRun(input: {
  teamId: string;
  runId: string;
  agentId: string;
  projectId: string;
  taskId: string;
  payload: Record<string, unknown>;
}) {
  await db.insert(runs).values({
    id: input.runId,
    teamId: input.teamId,
    executor: "daemon",
    agentId: input.agentId,
    projectId: input.projectId,
    projectTaskId: input.taskId,
    status: "queued",
    kind: "chat",
    input: input.payload,
  });
  await db
    .update(projectTasks)
    .set({ status: "running", lastRunId: input.runId, updatedAt: sql`now()` })
    .where(eq(projectTasks.id, input.taskId));
  await db.insert(projectTaskComments).values({
    id: genId("pmsg"),
    teamId: input.teamId,
    projectTaskId: input.taskId,
    authorKind: "system",
    content: "Run queued for the assigned agent.",
    runId: input.runId,
  });
}
