import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";
import { listMemory } from "../learning/memory/repo";
import type { ProjectResourceType, ProjectTaskPriority, ProjectTaskStatus, ProjectType } from "../../infra/db/schema";

const { projects, projectResources, projectTasks, projectTaskComments, projectWorkspaces, runs, agents } = schema;

const PROJECT_TYPES: ProjectType[] = ["ops", "code", "hybrid"];
const RESOURCE_TYPES: ProjectResourceType[] = ["git_repo", "local_dir", "url", "document", "tool"];
const TASK_STATUSES: ProjectTaskStatus[] = ["backlog", "ready", "running", "blocked", "review", "done", "cancelled"];
const TASK_PRIORITIES: ProjectTaskPriority[] = ["P0", "P1", "P2", "P3"];

type ProjectRow = typeof projects.$inferSelect;
type ProjectTaskRow = typeof projectTasks.$inferSelect;
type ProjectResourceRow = typeof projectResources.$inferSelect;
type ProjectMemoryRow = Awaited<ReturnType<typeof listMemory>>[number];

interface RunApprovalPolicy {
  requiresApproval: true;
  approved: false;
  message: string;
  risks: string[];
}

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

async function assertProject(teamId: string, projectId: string) {
  const [project] = await db.select().from(projects).where(and(eq(projects.teamId, teamId), eq(projects.id, projectId))).limit(1);
  return project ?? null;
}

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

function taskPrompt(input: {
  project: ProjectRow;
  task: ProjectTaskRow;
  instruction?: string;
  resources: ProjectResourceRow[];
  memories: ProjectMemoryRow[];
  approval?: RunApprovalPolicy | null;
}) {
  const resourceLines = input.resources.length
    ? input.resources.map((r) => `- ${r.type}: ${r.label || r.ref} (${r.ref})`).join("\n")
    : "- No attached resource yet.";
  const memoryLines = input.memories.length
    ? input.memories.map((memory) => `- ${memory.content}`).join("\n")
    : "- No confirmed project memory yet.";
  return [
    `Project: ${input.project.name}`,
    `Project type: ${input.project.type}`,
    input.project.description ? `Project context: ${input.project.description}` : "",
    "",
    `Task: ${input.task.title}`,
    input.task.description ? `Task detail: ${input.task.description}` : "",
    input.instruction ? `Operator instruction: ${input.instruction}` : "",
    "",
    "Project resources:",
    resourceLines,
    "",
    "Confirmed project memory:",
    memoryLines,
    input.approval ? "" : "",
    input.approval ? `Preflight approval required before execution: ${input.approval.risks.join(", ")}.` : "",
    "",
    "Work as an Agentik project agent. Produce concise progress, mention blockers, and for coding tasks report files/tests/diff expectations.",
  ]
    .filter(Boolean)
    .join("\n");
}

function riskyApprovalPolicy(input: {
  project: ProjectRow;
  task: ProjectTaskRow;
  instruction?: string;
  resources: ProjectResourceRow[];
}): RunApprovalPolicy | null {
  const text = [input.project.name, input.project.description, input.task.title, input.task.description, input.instruction]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const checks: Array<[string, RegExp]> = [
    ["destructive shell/filesystem", /\b(rm\s+-rf|delete|destroy|drop\s+table|truncate|wipe|erase|remove\s+all)\b/],
    ["production deploy", /\b(deploy|release|production|prod|ship)\b/],
    ["external write", /\b(git\s+push|push\s+to|send\s+email|webhook|post\s+to|external\s+api|write\s+to\s+api)\b/],
    ["billing/provider change", /\b(stripe|charge|refund|invoice|paid|billing|provider\s+key|api\s+key)\b/],
    ["database migration", /\b(migrate|migration|schema\s+change|alter\s+table)\b/],
  ];
  const risks = checks.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const hasWritableWorkspace = input.resources.some((resource) => resource.type === "git_repo" || resource.type === "local_dir");
  if (hasWritableWorkspace && /\b(commit|merge|rebase|checkout\s+-b|branch)\b/.test(text)) {
    risks.push("git mutation");
  }
  const uniqueRisks = [...new Set(risks)];
  if (!uniqueRisks.length) return null;
  return {
    requiresApproval: true,
    approved: false,
    message: `Approval required before executing risky project task: ${uniqueRisks.join(", ")}.`,
    risks: uniqueRisks,
  };
}

export async function runProjectTask(teamId: string, projectTaskId: string, instruction?: string) {
  const [task] = await db.select().from(projectTasks).where(and(eq(projectTasks.teamId, teamId), eq(projectTasks.id, projectTaskId))).limit(1);
  if (!task) return { error: "task_not_found" as const };
  const [project] = await db.select().from(projects).where(and(eq(projects.teamId, teamId), eq(projects.id, task.projectId))).limit(1);
  if (!project) return { error: "project_not_found" as const };
  const agentId = task.assignedAgentId ?? project.leadAgentId;
  if (!agentId) return { error: "agent_required" as const };
  const [agent] = await db
    .select({ id: agents.id, liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  if (!agent) return { error: "agent_not_found" as const };
  if (!agent.liveVersionId) return { error: "not_published" as const };

  const resources = await db.select().from(projectResources).where(and(eq(projectResources.teamId, teamId), eq(projectResources.projectId, project.id)));
  const memories = await listMemory(teamId, { scope: "project", targetId: project.id });
  const approval = riskyApprovalPolicy({ project, task, instruction, resources });
  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId,
    executor: "daemon",
    agentId,
    projectId: project.id,
    projectTaskId: task.id,
    status: "queued",
    kind: "chat",
    input: {
      prompt: taskPrompt({ project, task, instruction, resources, memories, approval }),
      ...(approval ? { approval } : {}),
    },
  });
  await db.update(projectTasks).set({ status: "running", lastRunId: runId, updatedAt: sql`now()` }).where(eq(projectTasks.id, task.id));
  await db.insert(projectTaskComments).values({
    id: genId("pmsg"),
    teamId,
    projectTaskId: task.id,
    authorKind: "system",
    content: "Run queued for the assigned agent.",
    runId,
  });
  hub.publish(teamId, { kind: "run", action: "created", runId });
  return { runId };
}
