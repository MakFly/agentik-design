/**
 * Integration tests for the project-centric cockpit. They run against a REAL
 * Postgres and skip automatically when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import { createAgent, getRunDetail, publishAgent } from "../../../src/domains/runs";
import { addProjectResource, createProject, createProjectTask, runProjectTask } from "../../../src/domains/projects";
import { insertConfirmedMemory } from "../../../src/domains/learning/memory/service";
import { claimTask, registerDaemon } from "../../../src/execution/daemon/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[projects-repo] no DB reachable - skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("project task runs", () => {
  let teamId: string;
  let agentId: string;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-projects-${Date.now()}`);
    const agent = await createAgent(teamId, { name: "Project Runner", role: "operator" });
    agentId = agent.id;
    await publishAgent(teamId, agentId, { instructions: "work from project context", runtimeKind: "echo" });

    const project = await createProject(teamId, "usr_test", {
      name: "Client Ops",
      type: "hybrid",
      description: "Operations and code work for the client.",
      leadAgentId: agentId,
    });
    projectId = project.project!.id;
    await addProjectResource(teamId, projectId, {
      type: "git_repo",
      label: "Main repo",
      ref: "git@example.com:client/app.git",
    });
    const task = await createProjectTask(teamId, projectId, "usr_test", {
      title: "Fix checkout bug",
      description: "Inspect the checkout flow and propose a patch.",
      priority: "P1",
    });
    taskId = task.task!.id;
  });

  afterAll(async () => {
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.runtimes).where(eq(schema.runtimes.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    await db.delete(schema.projectTaskComments).where(eq(schema.projectTaskComments.teamId, teamId));
    await db.delete(schema.projectTasks).where(eq(schema.projectTasks.teamId, teamId));
    await db.delete(schema.projectWorkspaces).where(eq(schema.projectWorkspaces.teamId, teamId));
    await db.delete(schema.projectResources).where(eq(schema.projectResources.teamId, teamId));
    await db.delete(schema.projects).where(eq(schema.projects.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("runProjectTask creates an agent run with project context for the run view", async () => {
    const run = await runProjectTask(teamId, taskId, "Use the attached repo.");
    const runId = "runId" in run && run.runId ? run.runId : null;
    if (!runId) throw new Error(`expected runId, got ${"error" in run ? run.error : "unknown"}`);
    expect(runId.startsWith("run_")).toBe(true);

    const detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("queued");
    expect(detail?.projectContext?.project.name).toBe("Client Ops");
    expect(detail?.projectContext?.task.title).toBe("Fix checkout bug");
    expect(detail?.projectContext?.resources[0]?.ref).toBe("git@example.com:client/app.git");
  });

  test("confirmed project memory is injected into the next project task prompt", async () => {
    await insertConfirmedMemory({
      teamId,
      scope: "project",
      targetId: projectId,
      content: "Use bun for every command in this repo.",
      confidence: 1,
      createdBy: "user",
    });

    const task = await createProjectTask(teamId, projectId, "usr_test", {
      title: "Check package scripts",
      priority: "P2",
    });
    const run = await runProjectTask(teamId, task.task!.id);
    const runId = "runId" in run && run.runId ? run.runId : null;
    if (!runId) throw new Error(`expected runId, got ${"error" in run ? run.error : "unknown"}`);

    const [agentTask] = await db
      .select({ input: schema.runs.input })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);
    expect((agentTask?.input as { prompt?: string })?.prompt).toContain("Confirmed project memory");
    expect((agentTask?.input as { prompt?: string })?.prompt).toContain("Use bun for every command in this repo.");
  });

  test("risky project tasks carry a preflight approval policy", async () => {
    const task = await createProjectTask(teamId, projectId, "usr_test", {
      title: "Deploy production migration",
      description: "Run the database migration and deploy to production.",
      priority: "P0",
    });
    const run = await runProjectTask(teamId, task.task!.id, "Push the release after the migration.");
    const runId = "runId" in run && run.runId ? run.runId : null;
    if (!runId) throw new Error(`expected runId, got ${"error" in run ? run.error : "unknown"}`);

    const [agentTask] = await db
      .select({ input: schema.runs.input })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);
    const approval = (agentTask?.input as { approval?: { requiresApproval?: boolean; risks?: string[] } })?.approval;
    expect(approval?.requiresApproval).toBe(true);
    expect(approval?.risks).toContain("production deploy");
    expect(approval?.risks).toContain("database migration");
  });

  test("daemon claim attaches a reusable project workspace for repo-backed tasks", async () => {
    const task = await createProjectTask(teamId, projectId, "usr_test", {
      title: "Prepare repo workspace",
      priority: "P0",
    });
    const run = await runProjectTask(teamId, task.task!.id, "Prepare the attached repository.");
    const runId = "runId" in run && run.runId ? run.runId : null;
    if (!runId) throw new Error(`expected runId, got ${"error" in run ? run.error : "unknown"}`);

    await db
      .update(schema.runs)
      .set({ status: "cancelled" })
      .where(and(eq(schema.runs.teamId, teamId), ne(schema.runs.id, runId), eq(schema.runs.status, "queued")));

    const registered = await registerDaemon({
      teamId,
      name: "workspace-test-daemon",
      runtimes: [{ kind: "echo" }],
    });
    const claimed = await claimTask(registered.runtimes[0]!.id);

    expect(claimed?.id).toBe(runId);
    expect(claimed?.workspace?.type).toBe("git_repo");
    expect(claimed?.workspace?.ref).toBe("git@example.com:client/app.git");
    expect(claimed?.workspace?.path).toContain(`projects/${projectId}/pwsp_`);
    expect(claimed?.workDir).toBe(claimed?.workspace?.path);

    const [workspace] = await db
      .select()
      .from(schema.projectWorkspaces)
      .where(and(eq(schema.projectWorkspaces.teamId, teamId), eq(schema.projectWorkspaces.projectId, projectId)))
      .limit(1);
    expect(workspace?.daemonId).toBe(registered.daemonId);
    expect(workspace?.resourceId).toBe(claimed?.workspace?.resourceId);
  });
});
