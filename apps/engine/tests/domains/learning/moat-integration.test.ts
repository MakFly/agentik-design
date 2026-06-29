/**
 * Integration tests for the learning-loop moat, run against a REAL Postgres.
 * They SKIP automatically when no DB is reachable, so `bun test` stays green offline
 * (pure unit tests still run). Run the full suite with infra-postgres up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import { createAgent, publishAgent } from "../../../src/domains/runs";
import {
  applyRunReview,
  archiveMemory,
  createMemory,
  generateRunReview,
  getRunReview,
  listMemory,
  listMemoryEvents,
  listAgentVersions,
  resolveMemoryInjectionPreview,
  resolveInjectionContext,
  restoreMemory,
  searchChatMemory,
  setRunReviewStatus,
  updateMemory,
} from "../../../src/domains/learning/index";
import { claimTask } from "../../../src/execution/daemon/repo";
import { cancelRun, getRunDetail } from "../../../src/domains/runs";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[moat-integration] no DB reachable — skipping integration tests");

const d = dbUp ? describe : describe.skip;

/** Narrow a publish result to the success shape (these tests never pin a daemon). */
function published(res: Awaited<ReturnType<typeof publishAgent>>) {
  if (!res || "error" in res) throw new Error(`expected published version, got ${JSON.stringify(res)}`);
  return res;
}

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
    expect(published(res).version).toBe(1);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
    expect(agent?.liveVersionId).toBe(published(res).versionId);
    // publish must sync the agent's runtime_kind to the version, or claimTask routes runs to the
    // wrong runtime (a claude agent would be claimed by a codex daemon).
    expect(agent?.runtimeKind).toBe("claude");
    const versions = await listAgentVersions(teamId, agentId);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.instructions).toBe("do v1");
    expect(versions[0]?.runtimeKind).toBe("claude");
  });

  test("second publish → version 2 (monotonic, immutable history kept)", async () => {
    const res = await publishAgent(teamId, agentId, { instructions: "do v2" });
    expect(published(res).version).toBe(2);
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
  let runId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(slug);
    const a = await createAgent(teamId, { name: "Learning Agent" });
    agentId = a.id;
    // Live version with default policies (inject agent+team-scoped memory, minConfidence 0.5).
    await publishAgent(teamId, agentId, { instructions: "base", runtimeKind: "claude" });
    // A finished (failed) run N with some streamed output.
    runId = genId("run");
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
      agentId,
      status: "failed",
      kind: "direct",
      input: { prompt: "do the thing" },
      error: "timed out calling the API",
    });
    await db.insert(schema.runMessages).values([
      { id: genId("amsg"), runId: runId, seq: 0, type: "text", content: "starting" },
      { id: genId("amsg"), runId: runId, seq: 1, type: "error", content: "timed out calling the API" },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.runReviews).where(eq(schema.runReviews.teamId, teamId));
    await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("step 6: completed run produces a PENDING review with a memory proposal", async () => {
    const review = await generateRunReview(teamId, runId);
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
    const review = await generateRunReview(teamId, runId); // idempotent: returns the existing pending review
    const res = await applyRunReview(teamId, review!.id, [`m0`]);
    expect(res?.applied).toBe(1);

    // status flipped to applied
    const [applied] = await db.select().from(schema.runReviews).where(eq(schema.runReviews.id, review!.id)).limit(1);
    expect(applied?.status).toBe("applied");

    // memory row exists, sourced from the run
    const mem = await db.select().from(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    expect(mem).toHaveLength(1);
    expect(mem[0]?.sourceRunId).toBe(runId);

    // THE MOAT: the approved memory is now in what the next run would receive.
    const ctx = await resolveInjectionContext(teamId, agentId);
    expect(ctx.memories.length).toBeGreaterThanOrEqual(1);
    expect(ctx.memories.some((m) => m.content.includes("timed out"))).toBe(true);
  });

  test("step 9 (runtime side): a claimed next-run task carries the memory in its prompt", async () => {
    // Register a daemon + claude runtime for this team so the queued task is claimable.
    const daemonId = genId("daemon");
    const runtimeId = genId("runtime");
    await db.insert(schema.daemons).values({ id: daemonId, teamId, name: "itest-daemon" });
    await db.insert(schema.runtimes).values({ id: runtimeId, daemonId, teamId, kind: "claude" });
    // Queue run N+1 for the same (claude) agent.
    const nextTaskId = genId("run");
    await db.insert(schema.runs).values({
      id: nextTaskId,
      teamId,
      executor: "daemon",
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
  let runId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(slug);
    otherTeam = await resolveTeam(`${slug}-other`);
    const a = await createAgent(teamId, { name: "Sec Agent" });
    agentId = a.id;
    await publishAgent(teamId, agentId, { instructions: "x", runtimeKind: "claude" });
    runId = genId("run");
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
      agentId,
      status: "failed",
      kind: "direct",
      input: { prompt: "p" },
      error: "boom",
    });
  });

  afterAll(async () => {
    await db.delete(schema.runs).where(eq(schema.runs.teamId, teamId));
    await db.delete(schema.runReviews).where(eq(schema.runReviews.teamId, teamId));
    await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, otherTeam));
  });

  test("getRunDetail / cancelRun reject a run from another org", async () => {
    expect(await getRunDetail(otherTeam, runId)).toBeNull();
    expect(await getRunDetail(teamId, runId)).not.toBeNull();
    expect(await cancelRun(otherTeam, runId)).toBe(false);
  });

  test("a rejected review can never be applied", async () => {
    const review = await generateRunReview(teamId, runId);
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

d("Memory cockpit — durable memory CRUD, audit, preview, and session recall", () => {
  const slug = `itest-memory-${Date.now()}`;
  let teamId: string;
  let projectId: string;
  let agentId: string;
  let memoryId: string;
  let chatSessionId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(slug);
    const agent = await createAgent(teamId, { name: "Memory Agent" });
    agentId = agent.id;
    await publishAgent(teamId, agentId, { instructions: "remember safely", runtimeKind: "claude" });
    projectId = genId("proj");
    await db.insert(schema.projects).values({
      id: projectId,
      teamId,
      name: "Memory Project",
      type: "ops",
      createdBy: "usr_test",
    });
    chatSessionId = genId("chat");
    await db.insert(schema.chatSessions).values({
      id: chatSessionId,
      teamId,
      agentId,
      creatorId: "usr_test",
      title: "Memory source",
    });
    await db.insert(schema.chatMessages).values({
      id: genId("cmsg"),
      chatSessionId,
      role: "user",
      content: "The client prefers concise French weather summaries.",
    });
  });

  afterAll(async () => {
    await db.delete(schema.chatSessions).where(eq(schema.chatSessions.teamId, teamId));
    await db.delete(schema.memoryEvents).where(eq(schema.memoryEvents.teamId, teamId));
    await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.teamId, teamId));
    await db.delete(schema.projects).where(eq(schema.projects.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("creates, updates, archives, restores, searches, and audits memory", async () => {
    const created = await createMemory({
      teamId,
      scope: "project",
      targetId: projectId,
      content: "Weather answers must mention the source conflict when providers disagree.",
      confidence: 0.9,
      actorId: "usr_test",
    });
    expect("memory" in created).toBe(true);
    memoryId = "memory" in created ? created.memory.id : "";

    const updated = await updateMemory({
      teamId,
      memoryId,
      actorId: "usr_test",
      content: "Weather answers must mention source conflicts and keep the answer concise.",
      confidence: 0.95,
    });
    expect("memory" in updated ? updated.memory.confidence : 0).toBe(0.95);

    const search = await listMemory(teamId, { q: "source conflicts" });
    expect(search.some((memory) => memory.id === memoryId)).toBe(true);

    const archived = await archiveMemory(teamId, memoryId, "usr_test");
    if (!("memory" in archived)) throw new Error("memory archive failed");
    const archivedMemory = archived.memory;
    if (!archivedMemory) throw new Error("memory archive returned no row");
    expect(archivedMemory.archivedAt).toBeTruthy();
    expect(await listMemory(teamId)).toHaveLength(0);

    const restored = await restoreMemory(teamId, memoryId, "usr_test");
    expect("memory" in restored ? restored.memory?.archivedAt : "x").toBeNull();

    const events = await listMemoryEvents(teamId, memoryId);
    expect(new Set(events.map((event) => event.action))).toEqual(
      new Set(["create", "update", "archive", "restore"]),
    );
  });

  test("preview uses the same injection resolver as runtime claim", async () => {
    await createMemory({
      teamId,
      scope: "agent",
      targetId: agentId,
      content: "For this agent, prefer direct operational answers.",
      confidence: 0.8,
      actorId: "usr_test",
    });
    const preview = await resolveMemoryInjectionPreview(teamId, agentId);
    expect(preview?.memories.some((memory) => memory.content.includes("operational answers"))).toBe(true);
  });

  test("session recall finds chat turns without making them durable", async () => {
    const hits = await searchChatMemory(teamId, "concise French");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sessionId).toBe(chatSessionId);
    const durable = await listMemory(teamId, { q: "concise French" });
    expect(durable).toHaveLength(0);
  });
});
