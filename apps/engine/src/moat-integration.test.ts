/**
 * Integration tests for the learning-loop moat, run against a REAL Postgres.
 * They SKIP automatically when no DB is reachable, so `bun test` stays green offline
 * (pure unit tests still run). Run the full suite with infra-postgres up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { resolveTeam } from "./repo";
import { createAgent, publishAgent } from "./agents-repo";
import {
  applyRunReview,
  generateRunReview,
  getRunReview,
  listAgentVersions,
  resolveInjectionContext,
  setRunReviewStatus,
} from "./learning-repo";
import { claimTask } from "./daemon-repo";
import { cancelAgentTask, getRunUnified } from "./agents-repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[moat-integration] no DB reachable — skipping integration tests");

const d = dbUp ? describe : describe.skip;

d("Phase B — publishAgent writes immutable, monotonic versions", () => {
  const slug = `itest-b-${Date.now()}`;
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(slug);
    const a = await createAgent(teamId, { name: "Versioned Agent" });
    agentId = a.id;
  });

  afterAll(async () => {
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId)); // cascade → agent_versions
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("first publish → version 1, liveVersionId points at the immutable row", async () => {
    const res = await publishAgent(teamId, agentId, {
      instructions: "do v1",
      tools: ["get_weather"],
      runtimeKind: "claude",
    });
    expect(res?.version).toBe(1);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
    expect(agent?.liveVersionId).toBe(res!.versionId);
    const versions = await listAgentVersions(teamId, agentId);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.instructions).toBe("do v1");
    expect(versions[0]?.runtimeKind).toBe("claude");
  });

  test("second publish → version 2 (monotonic, immutable history kept)", async () => {
    const res = await publishAgent(teamId, agentId, { instructions: "do v2" });
    expect(res?.version).toBe(2);
    const versions = await listAgentVersions(teamId, agentId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]); // desc; v1 still present
  });

  test("publish on a foreign team is rejected (tenancy)", async () => {
    const otherTeam = await resolveTeam(`${slug}-other`);
    const res = await publishAgent(otherTeam, agentId, { instructions: "hijack" });
    expect(res).toBeNull();
    await db.delete(schema.teams).where(eq(schema.teams.id, otherTeam));
  });
});

d("Phase D+E — GOLDEN PATH: review → approve → inject into the next run", () => {
  const slug = `itest-loop-${Date.now()}`;
  let teamId: string;
  let agentId: string;
  let taskId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(slug);
    const a = await createAgent(teamId, { name: "Learning Agent" });
    agentId = a.id;
    // Live version with default policies (inject agent+team-scoped memory, minConfidence 0.5).
    await publishAgent(teamId, agentId, { instructions: "base", runtimeKind: "echo" });
    // A finished (failed) run N with some streamed output.
    taskId = genId("atask");
    await db.insert(schema.agentTasks).values({
      id: taskId,
      teamId,
      agentId,
      status: "failed",
      kind: "direct",
      input: { prompt: "do the thing" },
      error: "timed out calling the API",
    });
    await db.insert(schema.taskMessages).values([
      { id: genId("amsg"), taskId, seq: 0, type: "text", content: "starting" },
      { id: genId("amsg"), taskId, seq: 1, type: "error", content: "timed out calling the API" },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.agentTasks).where(eq(schema.agentTasks.teamId, teamId));
    await db.delete(schema.runReviews).where(eq(schema.runReviews.teamId, teamId));
    await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("step 6: completed run produces a PENDING review with a memory proposal", async () => {
    const review = await generateRunReview(teamId, taskId);
    expect(review?.status).toBe("pending");
    expect(review?.riskLevel).toBe("medium");
    expect(review!.proposedMemories).toHaveLength(1);
    expect(review!.proposedMemories[0]?.targetId).toBe(agentId);
  });

  test("before approval: nothing is injected (review is propose-only)", async () => {
    const ctx = await resolveInjectionContext(teamId, agentId);
    expect(ctx.memories).toHaveLength(0);
  });

  test("steps 7-9: approve → memory persisted → injected into the NEXT run's context", async () => {
    const review = await generateRunReview(teamId, taskId); // idempotent: returns the existing pending review
    const res = await applyRunReview(teamId, review!.id, [`m0`]);
    expect(res?.applied).toBe(1);

    // status flipped to applied
    const [applied] = await db.select().from(schema.runReviews).where(eq(schema.runReviews.id, review!.id)).limit(1);
    expect(applied?.status).toBe("applied");

    // memory row exists, sourced from the run
    const mem = await db.select().from(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    expect(mem).toHaveLength(1);
    expect(mem[0]?.sourceRunId).toBe(taskId);

    // THE MOAT: the approved memory is now in what the next run would receive.
    const ctx = await resolveInjectionContext(teamId, agentId);
    expect(ctx.memories.length).toBeGreaterThanOrEqual(1);
    expect(ctx.memories.some((m) => m.content.includes("timed out"))).toBe(true);
  });

  test("step 9 (runtime side): a claimed next-run task carries the memory in its prompt", async () => {
    // Register a daemon + echo runtime for this team so the queued task is claimable.
    const daemonId = genId("daemon");
    const runtimeId = genId("runtime");
    await db.insert(schema.daemons).values({ id: daemonId, teamId, name: "itest-daemon" });
    await db.insert(schema.runtimes).values({ id: runtimeId, daemonId, teamId, kind: "echo" });
    // Queue run N+1 for the same (echo) agent.
    const nextTaskId = genId("atask");
    await db.insert(schema.agentTasks).values({
      id: nextTaskId,
      teamId,
      agentId,
      status: "queued",
      kind: "direct",
      input: { prompt: "do the next thing" },
    });

    const claimed = await claimTask(runtimeId);
    expect(claimed?.id).toBe(nextTaskId);
    const input = claimed!.input as { prompt: string };
    expect(input.prompt).toContain("do the next thing"); // original preserved
    expect(input.prompt).toContain("timed out"); // injected learned memory
    expect(claimed!.context?.memories.length).toBeGreaterThanOrEqual(1);

    await db.delete(schema.daemons).where(eq(schema.daemons.id, daemonId)); // cascade → runtimes
  });
});

d("Security regressions — tenancy & review-state guards", () => {
  const slug = `itest-sec-${Date.now()}`;
  let teamId: string;
  let otherTeam: string;
  let agentId: string;
  let taskId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(slug);
    otherTeam = await resolveTeam(`${slug}-other`);
    const a = await createAgent(teamId, { name: "Sec Agent" });
    agentId = a.id;
    await publishAgent(teamId, agentId, { instructions: "x", runtimeKind: "echo" });
    taskId = genId("atask");
    await db.insert(schema.agentTasks).values({ id: taskId, teamId, agentId, status: "failed", kind: "direct", input: { prompt: "p" }, error: "boom" });
  });

  afterAll(async () => {
    await db.delete(schema.agentTasks).where(eq(schema.agentTasks.teamId, teamId));
    await db.delete(schema.runReviews).where(eq(schema.runReviews.teamId, teamId));
    await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, otherTeam));
  });

  test("getRunUnified / cancelAgentTask reject a run from another org", async () => {
    expect(await getRunUnified(otherTeam, taskId)).toBeNull();
    expect(await getRunUnified(teamId, taskId)).not.toBeNull();
    expect(await cancelAgentTask(otherTeam, taskId)).toBe(false);
  });

  test("a rejected review can never be applied", async () => {
    const review = await generateRunReview(teamId, taskId);
    await setRunReviewStatus(teamId, review!.id, "rejected");
    const res = await applyRunReview(teamId, review!.id, ["m0"]);
    expect(res?.alreadyApplied).toBe(true);
    expect(res?.applied).toBe(0);
    // no memory was written by the rejected apply
    const mem = await db.select().from(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    expect(mem).toHaveLength(0);
    // and the status stays rejected, not flipped to applied
    const after = await getRunReview(teamId, review!.id);
    expect(after?.status).toBe("rejected");
  });
});
