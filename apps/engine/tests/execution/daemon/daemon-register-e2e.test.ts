/**
 * End-to-end (HTTP) test of POST /daemon/register through the real Hono app:
 * org-token auth → route → registerDaemon → Postgres. Proves the route wires
 * `legacyIds` all the way through so a host that upgrades its identity
 * (hostname → UUID) adopts its existing row instead of creating a duplicate.
 * Skips when no DB is reachable; requires DAEMON_ENABLED=true (set in .env).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import app from "../../../src/app/server";
import { db, schema } from "../../../src/infra/db/client";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
const d = dbUp ? describe : describe.skip;

d("e2e — POST /daemon/register reconciles the hostname → UUID transition", () => {
  const stamp = Date.now();
  const teamId = `team_e2e_${stamp}`;
  const slug = `e2e-${stamp}`;
  const token = `daemontok_e2e_${stamp}_padpadpadpad`;

  const register = (body: unknown, auth = true) =>
    app.fetch(
      new Request("http://e2e.test/daemon/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(auth ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const countDaemons = async () =>
    (
      await db
        .select()
        .from(schema.daemons)
        .where(eq(schema.daemons.teamId, teamId))
    ).length;

  beforeAll(async () => {
    await db
      .insert(schema.teams)
      .values({ id: teamId, slug, name: "E2E", daemonToken: token });
  });
  afterAll(async () => {
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("rejects a register without the org token", async () => {
    const res = await register(
      { name: "x", runtimes: [{ kind: "echo" }] },
      false,
    );
    expect(res.status).toBe(401);
  });

  test("legacy hostname row is adopted on UUID re-register (single row)", async () => {
    const host = `e2ehost-${stamp}`;
    const uuid = `e2euuid-${stamp}`;

    // Old binary: registers under the hostname, no deviceId.
    const r1 = await register({
      name: host,
      meta: { mode: "org" },
      runtimes: [{ kind: "echo" }],
    });
    expect(r1.status).toBe(201);
    const reg1 = (await r1.json()) as { daemonId: string };
    expect(await countDaemons()).toBe(1);

    // New binary: UUID identity, reports the legacy hostname, sets deviceId.
    const r2 = await register({
      name: uuid,
      legacyIds: [host],
      meta: { deviceId: uuid, mode: "org" },
      runtimes: [{ kind: "echo" }, { kind: "claude" }],
    });
    expect(r2.status).toBe(201);
    const reg2 = (await r2.json()) as { daemonId: string };

    expect(reg2.daemonId).toBe(reg1.daemonId); // adopted, not duplicated
    expect(await countDaemons()).toBe(1);

    const [row] = await db
      .select()
      .from(schema.daemons)
      .where(eq(schema.daemons.id, reg1.daemonId));
    expect(row).toBeDefined();
    expect(row!.name).toBe(uuid); // org mode → no "· team" suffix
    expect((row!.meta as { deviceId?: string }).deviceId).toBe(uuid);
  });
});
