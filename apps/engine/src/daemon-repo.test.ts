/**
 * Daemon register dedup + delete-guard integration tests against a REAL Postgres.
 * Skips when no DB is reachable. Covers the hostname → UUID identity transition
 * (legacy-row adoption) that previously spawned duplicate "connected computers".
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { deleteDaemon, registerDaemon } from "./daemon-repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
const d = dbUp ? describe : describe.skip;

d("daemon-repo — register dedup & delete guards", () => {
  const stamp = Date.now();
  const teamId = `team_dtest_${stamp}`;
  const slug = `dtest-${stamp}`;

  const countDaemons = async () =>
    (
      await db
        .select()
        .from(schema.daemons)
        .where(eq(schema.daemons.teamId, teamId))
    ).length;
  const rowById = async (id: string) =>
    (
      await db.select().from(schema.daemons).where(eq(schema.daemons.id, id))
    )[0];

  beforeAll(async () => {
    await db
      .insert(schema.teams)
      .values({ id: teamId, slug, name: "Daemon Test" });
  });
  afterAll(async () => {
    await db
      .delete(schema.agentTasks)
      .where(eq(schema.agentTasks.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("fresh register inserts a daemon with its runtimes", async () => {
    const dev = `dev-fresh-${stamp}`;
    const res = await registerDaemon({
      teamId,
      name: `${dev} · ${slug}`,
      meta: { deviceId: dev },
      runtimes: [{ kind: "echo" }],
    });
    expect(res.daemonId).toBeTruthy();
    expect(res.runtimes.map((r) => r.kind)).toEqual(["echo"]);
  });

  test("re-register with the same deviceId updates in place (no duplicate)", async () => {
    const dev = `dev-reuse-${stamp}`;
    const first = await registerDaemon({
      teamId,
      name: `${dev} · ${slug}`,
      meta: { deviceId: dev },
      runtimes: [{ kind: "echo" }],
    });
    const before = await countDaemons();
    const second = await registerDaemon({
      teamId,
      name: `${dev}-renamed · ${slug}`,
      meta: { deviceId: dev },
      runtimes: [{ kind: "echo" }, { kind: "claude" }],
    });
    expect(second.daemonId).toBe(first.daemonId);
    expect(await countDaemons()).toBe(before);
    const row = await rowById(first.daemonId);
    expect(row).toBeDefined();
    expect(row!.name).toBe(`${dev}-renamed · ${slug}`);
  });

  test("legacy hostname row is adopted on the UUID transition (no duplicate)", async () => {
    const host = `host-${stamp}`;
    const uuid = `uuid-${stamp}`;
    // Old binary: registered by hostname, no deviceId in meta.
    const legacy = await registerDaemon({
      teamId,
      name: `${host} · ${slug}`,
      meta: { mode: "personal" },
      runtimes: [{ kind: "echo" }],
    });
    const before = await countDaemons();
    // New binary: UUID identity + reports the legacy hostname.
    const upgraded = await registerDaemon({
      teamId,
      name: `${uuid} · ${slug}`,
      legacyNames: [`${host} · ${slug}`],
      meta: { deviceId: uuid },
      runtimes: [{ kind: "echo" }],
    });
    expect(upgraded.daemonId).toBe(legacy.daemonId); // adopted, not duplicated
    expect(await countDaemons()).toBe(before);
    const row = await rowById(legacy.daemonId);
    expect(row).toBeDefined();
    expect(row!.name).toBe(`${uuid} · ${slug}`);
    expect((row!.meta as { deviceId?: string }).deviceId).toBe(uuid);
    // Subsequent plain re-register now matches by deviceId.
    const again = await registerDaemon({
      teamId,
      name: `${uuid} · ${slug}`,
      meta: { deviceId: uuid },
      runtimes: [{ kind: "echo" }],
    });
    expect(again.daemonId).toBe(legacy.daemonId);
    expect(await countDaemons()).toBe(before);
  });

  test("a meta-less re-register keeps the stored deviceId", async () => {
    const dev = `dev-keep-${stamp}`;
    const first = await registerDaemon({
      teamId,
      name: `${dev} · ${slug}`,
      meta: { deviceId: dev },
      runtimes: [{ kind: "echo" }],
    });
    // Matched by name, but the payload omits deviceId.
    await registerDaemon({
      teamId,
      name: `${dev} · ${slug}`,
      meta: { mode: "personal" },
      runtimes: [{ kind: "echo" }],
    });
    const row = await rowById(first.daemonId);
    expect(row).toBeDefined();
    expect(row!.meta).toMatchObject({ deviceId: dev });
  });

  test("deleteDaemon: not_found for an unknown id", async () => {
    expect(await deleteDaemon(teamId, "daemon_nope")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  test("deleteDaemon: refuses a still-online (fresh heartbeat) daemon", async () => {
    const dev = `dev-online-${stamp}`;
    const reg = await registerDaemon({
      teamId,
      name: `${dev} · ${slug}`,
      meta: { deviceId: dev },
      runtimes: [{ kind: "echo" }],
    });
    expect(await deleteDaemon(teamId, reg.daemonId)).toEqual({
      ok: false,
      reason: "online",
    });
  });

  test("deleteDaemon: refuses a stale daemon with an in-flight task", async () => {
    const dev = `dev-busy-${stamp}`;
    const reg = await registerDaemon({
      teamId,
      name: `${dev} · ${slug}`,
      meta: { deviceId: dev },
      runtimes: [{ kind: "echo" }],
    });
    await db
      .update(schema.daemons)
      .set({ lastHeartbeatAt: sql`now() - interval '10 minutes'` })
      .where(eq(schema.daemons.id, reg.daemonId));
    await db.insert(schema.agentTasks).values({
      id: `atask_${stamp}_busy`,
      teamId,
      agentId: "agent_x",
      daemonId: reg.daemonId,
      status: "running",
    });
    expect(await deleteDaemon(teamId, reg.daemonId)).toEqual({
      ok: false,
      reason: "busy",
    });
  });

  test("deleteDaemon: removes a stale, idle daemon", async () => {
    const dev = `dev-del-${stamp}`;
    const reg = await registerDaemon({
      teamId,
      name: `${dev} · ${slug}`,
      meta: { deviceId: dev },
      runtimes: [{ kind: "echo" }],
    });
    await db
      .update(schema.daemons)
      .set({ lastHeartbeatAt: sql`now() - interval '10 minutes'` })
      .where(eq(schema.daemons.id, reg.daemonId));
    expect(await deleteDaemon(teamId, reg.daemonId)).toEqual({ ok: true });
    expect(await rowById(reg.daemonId)).toBeUndefined();
  });
});
