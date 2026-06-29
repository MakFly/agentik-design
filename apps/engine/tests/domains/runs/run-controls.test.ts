/**
 * Integration tests for run controls and approval gates. They run against a REAL
 * Postgres and skip automatically when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import {
  approveRun,
  createAgent,
  getRunDetail,
  pauseRun,
  rejectRun,
  requestRunApproval,
  resumeRun,
} from "../../../src/domains/runs";
import { claimTask, registerDaemon } from "../../../src/execution/daemon/repo";
import { requestDaemonTaskApproval } from "../../../src/execution/daemon/service";

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
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.runtimes).where(eq(schema.runtimes.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  async function queuedTask(prompt: string, input: Record<string, unknown> = { prompt }) {
    const id = genId("run");
    await db.insert(schema.runs).values({
      id,
      teamId,
      executor: "daemon",
      agentId,
      status: "queued",
      kind: "direct",
      input,
    });
    return id;
  }

  test("pause and resume gate a queued run and write timeline audit", async () => {
    const runId = await queuedTask("wait for operator");

    expect(await pauseRun(teamId, runId, "needs review")).toBe(true);
    let detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("paused");
    expect(detail?.steps.at(-1)?.summary).toContain("Run paused");

    expect(await resumeRun(teamId, runId, "approved to continue")).toBe(true);
    detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("queued");
    expect(detail?.steps.at(-1)?.summary).toContain("Run resumed");
    expect(detail?.run.stepCount).toBe(detail?.steps.length);
  });

  test("approval request blocks claimable work until approved", async () => {
    const runId = await queuedTask("needs external write");

    expect(await requestRunApproval(teamId, runId, "Allow external write?", { risk: "external_write" })).toBe(true);
    let detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("waiting_approval");
    expect(detail?.steps.at(-1)?.summary).toContain("Approval requested");

    expect(await approveRun(teamId, runId, "operator approved")).toBe(true);
    detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("queued");
    expect(detail?.steps.at(-1)?.summary).toContain("Approval granted");
  });

  test("approval rejection cancels the run", async () => {
    const runId = await queuedTask("risky deploy");

    expect(await requestRunApproval(teamId, runId, "Deploy to production?")).toBe(true);
    expect(await rejectRun(teamId, runId, "not during business hours")).toBe(true);
    const detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("cancelled");
    expect(detail?.steps.at(-1)?.summary).toContain("Approval rejected");
  });

  test("completed run detail exposes changed files and checks as artifacts", async () => {
    const runId = genId("run");
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
      agentId,
      status: "succeeded",
      kind: "direct",
      input: { prompt: "finish patch" },
      result: {
        result: "Patched the checkout flow.",
        changed_files: ["M apps/web/checkout.tsx", "A apps/web/checkout.test.tsx"],
        tests: [{ name: "bun test checkout", status: "passed", output: "2 passed" }],
      },
    });

    const detail = await getRunDetail(teamId, runId);
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
      .update(schema.runs)
      .set({ status: "cancelled" })
      .where(and(eq(schema.runs.teamId, teamId), ne(schema.runs.id, runId), eq(schema.runs.status, "queued")));
    const registered = await registerDaemon({
      teamId,
      name: "approval-test-daemon",
      runtimes: [{ kind: "claude" }],
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

    let detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("waiting_approval");
    expect(await claimTask(registered.runtimes[0]!.id)).toBeNull();

    expect(await approveRun(teamId, runId, "ship it")).toBe(true);
    const secondClaim = await claimTask(registered.runtimes[0]!.id);
    expect(secondClaim?.id).toBe(runId);
    expect((secondClaim?.input as { approval?: { approved?: boolean } }).approval?.approved).toBe(true);

    detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("queued");
  });

  test("daemon claim ignores dev simulator runs", async () => {
    await db
      .update(schema.runs)
      .set({ status: "cancelled" })
      .where(and(eq(schema.runs.teamId, teamId), eq(schema.runs.status, "queued")));
    const runId = await queuedTask("simulate-only email flow", {
      prompt: "simulate-only email flow",
      simulate: {
        requireApproval: true,
        email: {
          to: "operator@example.test",
          subject: "Acme kickoff — proposed slots",
          text: "Proposed slots.",
        },
      },
    });
    const registered = await registerDaemon({
      teamId,
      name: "simulate-skip-daemon",
      runtimes: [{ kind: "claude" }],
    });

    expect(await claimTask(registered.runtimes[0]!.id)).toBeNull();
    const detail = await getRunDetail(teamId, runId);
    expect(detail?.run.status).toBe("queued");
    expect(detail?.placement?.daemonId).toBeNull();
  });

  test("agent daemon pin only lets the selected daemon claim its queued runs", async () => {
    await db
      .update(schema.runs)
      .set({ status: "cancelled" })
      .where(and(eq(schema.runs.teamId, teamId), eq(schema.runs.status, "queued")));

    const first = await registerDaemon({
      teamId,
      name: "pinned-daemon-a",
      runtimes: [{ kind: "claude" }],
    });
    const second = await registerDaemon({
      teamId,
      name: "pinned-daemon-b",
      runtimes: [{ kind: "claude" }],
    });
    await db
      .update(schema.agents)
      .set({ preferredDaemonId: first.daemonId, runtimeKind: "claude" })
      .where(and(eq(schema.agents.teamId, teamId), eq(schema.agents.id, agentId)));

    const runId = await queuedTask("must run on daemon a");
    const secondEcho = second.runtimes.find((runtime) => runtime.kind === "claude");
    const firstEcho = first.runtimes.find((runtime) => runtime.kind === "claude");
    expect(secondEcho).toBeDefined();
    expect(firstEcho).toBeDefined();

    expect(await claimTask(secondEcho!.id)).toBeNull();
    const claimed = await claimTask(firstEcho!.id);
    expect(claimed?.id).toBe(runId);

    const detail = await getRunDetail(teamId, runId);
    expect(detail?.placement).toMatchObject({
      runtimeKind: "claude",
      daemonId: first.daemonId,
      daemonName: "pinned-daemon-a",
      pinned: true,
    });
  });
});
