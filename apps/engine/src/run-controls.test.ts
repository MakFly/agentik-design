/**
 * Integration tests for run controls and approval gates. They run against a REAL
 * Postgres and skip automatically when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { resolveTeam } from "./repo";
import {
  approveAgentTask,
  createAgent,
  getRunUnified,
  pauseAgentTask,
  rejectAgentTask,
  requestAgentTaskApproval,
  resumeAgentTask,
} from "./agents-repo";
import { claimTask, registerDaemon, requestDaemonTaskApproval } from "./daemon-repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[run-controls] no DB reachable - skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("agent run controls", () => {
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-run-controls-${Date.now()}`);
    const agent = await createAgent(teamId, { name: "Controlled Agent" });
    agentId = agent.id;
  });

  afterAll(async () => {
    await db.delete(schema.agentTasks).where(eq(schema.agentTasks.teamId, teamId));
    await db.delete(schema.runtimes).where(eq(schema.runtimes.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  async function queuedTask(prompt: string, input: Record<string, unknown> = { prompt }) {
    const id = genId("atask");
    await db.insert(schema.agentTasks).values({
      id,
      teamId,
      agentId,
      status: "queued",
      kind: "direct",
      input,
    });
    return id;
  }

  test("pause and resume gate a queued run and write timeline audit", async () => {
    const runId = await queuedTask("wait for operator");

    expect(await pauseAgentTask(teamId, runId, "needs review")).toBe(true);
    let detail = await getRunUnified(teamId, runId);
    expect(detail?.run.status).toBe("paused");
    expect(detail?.steps.at(-1)?.summary).toContain("Run paused");

    expect(await resumeAgentTask(teamId, runId, "approved to continue")).toBe(true);
    detail = await getRunUnified(teamId, runId);
    expect(detail?.run.status).toBe("queued");
    expect(detail?.steps.at(-1)?.summary).toContain("Run resumed");
    expect(detail?.run.stepCount).toBe(detail?.steps.length);
  });

  test("approval request blocks claimable work until approved", async () => {
    const runId = await queuedTask("needs external write");

    expect(await requestAgentTaskApproval(teamId, runId, "Allow external write?", { risk: "external_write" })).toBe(true);
    let detail = await getRunUnified(teamId, runId);
    expect(detail?.run.status).toBe("waiting_approval");
    expect(detail?.steps.at(-1)?.summary).toContain("Approval requested");

    expect(await approveAgentTask(teamId, runId, "operator approved")).toBe(true);
    detail = await getRunUnified(teamId, runId);
    expect(detail?.run.status).toBe("queued");
    expect(detail?.steps.at(-1)?.summary).toContain("Approval granted");
  });

  test("approval rejection cancels the run", async () => {
    const runId = await queuedTask("risky deploy");

    expect(await requestAgentTaskApproval(teamId, runId, "Deploy to production?")).toBe(true);
    expect(await rejectAgentTask(teamId, runId, "not during business hours")).toBe(true);
    const detail = await getRunUnified(teamId, runId);
    expect(detail?.run.status).toBe("cancelled");
    expect(detail?.steps.at(-1)?.summary).toContain("Approval rejected");
  });

  test("completed run detail exposes changed files and checks as artifacts", async () => {
    const runId = genId("atask");
    await db.insert(schema.agentTasks).values({
      id: runId,
      teamId,
      agentId,
      status: "completed",
      kind: "direct",
      input: { prompt: "finish patch" },
      result: {
        result: "Patched the checkout flow.",
        changed_files: ["M apps/web/checkout.tsx", "A apps/web/checkout.test.tsx"],
        tests: [{ name: "bun test checkout", status: "passed", output: "2 passed" }],
      },
    });

    const detail = await getRunUnified(teamId, runId);
    expect(detail?.artifacts?.summary).toBe("Patched the checkout flow.");
    expect(detail?.artifacts?.changedFiles).toEqual(["M apps/web/checkout.tsx", "A apps/web/checkout.test.tsx"]);
    expect(detail?.artifacts?.tests[0]).toMatchObject({ name: "bun test checkout", status: "passed" });
  });

  test("daemon preflight approval blocks a claimed task until approved, then claim proceeds", async () => {
    const runId = await queuedTask("deploy production", {
      prompt: "deploy production",
      approval: {
        requiresApproval: true,
        approved: false,
        message: "Approval required before deploy.",
        risks: ["production deploy"],
      },
    });
    await db
      .update(schema.agentTasks)
      .set({ status: "cancelled" })
      .where(and(eq(schema.agentTasks.teamId, teamId), ne(schema.agentTasks.id, runId), eq(schema.agentTasks.status, "queued")));
    const registered = await registerDaemon({
      teamId,
      name: "approval-test-daemon",
      runtimes: [{ kind: "echo" }],
    });

    const firstClaim = await claimTask(registered.runtimes[0]!.id);
    expect(firstClaim?.id).toBe(runId);
    expect((firstClaim?.input as { approval?: { requiresApproval?: boolean } }).approval?.requiresApproval).toBe(true);
    expect(
      await requestDaemonTaskApproval(runId, {
        message: "Approval required before deploy.",
        context: { risks: ["production deploy"] },
      }),
    ).toBe(true);

    let detail = await getRunUnified(teamId, runId);
    expect(detail?.run.status).toBe("waiting_approval");
    expect(await claimTask(registered.runtimes[0]!.id)).toBeNull();

    expect(await approveAgentTask(teamId, runId, "ship it")).toBe(true);
    const secondClaim = await claimTask(registered.runtimes[0]!.id);
    expect(secondClaim?.id).toBe(runId);
    expect((secondClaim?.input as { approval?: { approved?: boolean } }).approval?.approved).toBe(true);

    detail = await getRunUnified(teamId, runId);
    expect(detail?.run.status).toBe("queued");
  });

  test("agent daemon pin only lets the selected daemon claim its queued runs", async () => {
    await db
      .update(schema.agentTasks)
      .set({ status: "cancelled" })
      .where(and(eq(schema.agentTasks.teamId, teamId), eq(schema.agentTasks.status, "queued")));

    const first = await registerDaemon({
      teamId,
      name: "pinned-daemon-a",
      runtimes: [{ kind: "echo" }],
    });
    const second = await registerDaemon({
      teamId,
      name: "pinned-daemon-b",
      runtimes: [{ kind: "echo" }],
    });
    await db
      .update(schema.agents)
      .set({ preferredDaemonId: first.daemonId, runtimeKind: "echo" })
      .where(and(eq(schema.agents.teamId, teamId), eq(schema.agents.id, agentId)));

    const runId = await queuedTask("must run on daemon a");
    const secondEcho = second.runtimes.find((runtime) => runtime.kind === "echo");
    const firstEcho = first.runtimes.find((runtime) => runtime.kind === "echo");
    expect(secondEcho).toBeDefined();
    expect(firstEcho).toBeDefined();

    expect(await claimTask(secondEcho!.id)).toBeNull();
    const claimed = await claimTask(firstEcho!.id);
    expect(claimed?.id).toBe(runId);

    const detail = await getRunUnified(teamId, runId);
    expect(detail?.placement).toMatchObject({
      runtimeKind: "echo",
      daemonId: first.daemonId,
      daemonName: "pinned-daemon-a",
      pinned: true,
    });
  });
});
