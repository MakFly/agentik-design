/**
 * Auth + org tenancy integration tests against a REAL Postgres. Skip when no DB reachable.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db/client";
import {
  acceptInvitation,
  createInvitation,
  createOrg,
  getMembership,
  getSessionUser,
  getUserDaemonTokenStatus,
  listUserDaemonOrgs,
  listUserOrgs,
  login,
  resolveUserByDaemonToken,
  revokeUserDaemonToken,
  rotateUserDaemonToken,
  signUp,
  verifyEmail,
} from "./auth-repo";

let dbUp = false;
try {
  await db.execute(await import("drizzle-orm").then((m) => m.sql`select 1`));
  dbUp = true;
} catch {
  dbUp = false;
}
const d = dbUp ? describe : describe.skip;

d("Phase 0 — identity, org lifecycle & tenancy isolation", () => {
  const stamp = Date.now();
  const aliceEmail = `alice-${stamp}@test.dev`;
  const bobEmail = `bob-${stamp}@test.dev`;
  const userIds: string[] = [];
  const teamIds: string[] = [];

  afterAll(async () => {
    if (teamIds.length)
      await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
    if (userIds.length)
      await db
        .delete(schema.appUsers)
        .where(inArray(schema.appUsers.id, userIds));
  });

  test("sign-up hashes the password and rejects duplicates", async () => {
    const res = await signUp({
      email: aliceEmail,
      password: "supersecret1",
      name: "Alice",
    });
    if ("error" in res) throw new Error(`signup failed: ${res.error}`);
    userIds.push(res.user.id);
    const [row] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, aliceEmail))
      .limit(1);
    expect(row?.passwordHash).not.toBe("supersecret1"); // hashed
    const dup = await signUp({ email: aliceEmail, password: "x" });
    expect("error" in dup && dup.error).toBe("email_taken");
  });

  test("wrong password fails; unverified login is blocked (verify-before-access)", async () => {
    expect(await login({ email: aliceEmail, password: "wrong" })).toBeNull();
    const blocked = await login({
      email: aliceEmail,
      password: "supersecret1",
    });
    expect(blocked && "error" in blocked && blocked.error).toBe(
      "email_unverified",
    );
  });

  test("verify email clears the token", async () => {
    const [row] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, aliceEmail))
      .limit(1);
    expect(await verifyEmail(row!.verifyToken!)).toBe(true);
    const [after] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, aliceEmail))
      .limit(1);
    expect(after?.emailVerifiedAt).not.toBeNull();
  });

  test("after verification, login issues a working session", async () => {
    const ok = await login({ email: aliceEmail, password: "supersecret1" });
    if (!ok || "error" in ok) throw new Error("verified login should succeed");
    const user = await getSessionUser(ok.session.token);
    expect(user?.email).toBe(aliceEmail);
    expect(await getSessionUser("garbage-token")).toBeNull();
  });

  test("create org → owner membership + org-scoped daemon token", async () => {
    const alice = userIds[0]!;
    const org = await createOrg(alice, {
      name: "Acme Co",
      slug: `acme-${stamp}`,
    });
    if ("error" in org) throw new Error(`createOrg failed: ${org.error}`);
    teamIds.push(org.teamId);
    expect(org.daemonToken).toBeTruthy();
    expect(await getMembership(alice, org.teamId)).toBe("owner");
  });

  test("invite a second user → accept → membership; orgs stay isolated", async () => {
    const alice = userIds[0]!;
    const teamId = teamIds[0]!;
    const bob = await signUp({
      email: bobEmail,
      password: "bobsecret12",
      name: "Bob",
    });
    if ("error" in bob) throw new Error("bob signup failed");
    const bobId = bob.user.id;
    userIds.push(bobId);

    // Bob is in no orgs yet (isolation).
    expect(await listUserOrgs(bobId)).toHaveLength(0);

    const inv = await createInvitation(teamId, bobEmail, "engineer", alice);
    const accepted = await acceptInvitation(inv.token, bobId);
    if ("error" in accepted)
      throw new Error(`accept failed: ${accepted.error}`);
    expect(accepted.teamId).toBe(teamId);
    expect(await getMembership(bobId, teamId)).toBe("engineer");

    expect((await listUserOrgs(bobId)).map((o) => o.teamId)).toEqual([teamId]);
  });

  test("personal daemon token is revealed once, resolves by hash, and can be revoked", async () => {
    const alice = userIds[0]!;
    const before = await getUserDaemonTokenStatus(alice);
    expect(before?.hasToken).toBe(false);

    const rotated = await rotateUserDaemonToken(alice);
    expect(rotated?.token.startsWith("dtkn_")).toBe(true);
    expect(rotated?.prefix).toBe(rotated!.token.slice(0, 17));

    const status = await getUserDaemonTokenStatus(alice);
    expect(status?.hasToken).toBe(true);
    expect(status).not.toHaveProperty("token");

    expect(await resolveUserByDaemonToken(rotated!.token)).toBe(alice);
    expect(await resolveUserByDaemonToken(`${rotated!.token}x`)).toBeNull();

    const teamId = teamIds[0]!;
    const daemonId = `dmon_${stamp}`;
    const runtimeId = `rt_${stamp}`;
    await db.insert(schema.daemons).values({
      id: daemonId,
      teamId,
      name: "Alice laptop",
      meta: { mode: "personal", userId: alice },
    });
    await db.insert(schema.runtimes).values({
      id: runtimeId,
      daemonId,
      teamId,
      kind: "claude",
    });

    expect(await revokeUserDaemonToken(alice)).toBe(true);
    expect(await resolveUserByDaemonToken(rotated!.token)).toBeNull();
    expect(
      await db
        .select({ id: schema.daemons.id })
        .from(schema.daemons)
        .where(eq(schema.daemons.id, daemonId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: schema.runtimes.id })
        .from(schema.runtimes)
        .where(eq(schema.runtimes.id, runtimeId)),
    ).toEqual([]);
  });

  test("personal daemon org discovery includes owners/admins, not engineers", async () => {
    const alice = userIds[0]!;
    const bob = userIds[1]!;
    const teamId = teamIds[0]!;

    expect((await listUserDaemonOrgs(alice)).map((o) => o.teamId)).toContain(
      teamId,
    );
    expect(await listUserDaemonOrgs(bob)).toEqual([]);
  });
});
