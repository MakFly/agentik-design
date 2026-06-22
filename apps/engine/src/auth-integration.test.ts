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
  listUserOrgs,
  login,
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
    if (teamIds.length) await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
    if (userIds.length) await db.delete(schema.appUsers).where(inArray(schema.appUsers.id, userIds));
  });

  test("sign-up hashes the password and rejects duplicates", async () => {
    const res = await signUp({ email: aliceEmail, password: "supersecret1", name: "Alice" });
    if ("error" in res) throw new Error(`signup failed: ${res.error}`);
    userIds.push(res.user.id);
    const [row] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.email, aliceEmail)).limit(1);
    expect(row?.passwordHash).not.toBe("supersecret1"); // hashed
    const dup = await signUp({ email: aliceEmail, password: "x" });
    expect("error" in dup && dup.error).toBe("email_taken");
  });

  test("login issues a working session; wrong password fails", async () => {
    expect(await login({ email: aliceEmail, password: "wrong" })).toBeNull();
    const ok = await login({ email: aliceEmail, password: "supersecret1" });
    expect(ok).not.toBeNull();
    const user = await getSessionUser(ok!.session.token);
    expect(user?.email).toBe(aliceEmail);
    expect(await getSessionUser("garbage-token")).toBeNull();
  });

  test("verify email clears the token", async () => {
    const [row] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.email, aliceEmail)).limit(1);
    expect(await verifyEmail(row!.verifyToken!)).toBe(true);
    const [after] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.email, aliceEmail)).limit(1);
    expect(after?.emailVerifiedAt).not.toBeNull();
  });

  test("create org → owner membership + org-scoped daemon token", async () => {
    const alice = userIds[0]!;
    const org = await createOrg(alice, { name: "Acme Co", slug: `acme-${stamp}` });
    if ("error" in org) throw new Error(`createOrg failed: ${org.error}`);
    teamIds.push(org.teamId);
    expect(org.daemonToken).toBeTruthy();
    expect(await getMembership(alice, org.teamId)).toBe("owner");
  });

  test("invite a second user → accept → membership; orgs stay isolated", async () => {
    const alice = userIds[0]!;
    const teamId = teamIds[0]!;
    const bob = await signUp({ email: bobEmail, password: "bobsecret12", name: "Bob" });
    if ("error" in bob) throw new Error("bob signup failed");
    const bobId = bob.user.id;
    userIds.push(bobId);

    // Bob is in no orgs yet (isolation).
    expect(await listUserOrgs(bobId)).toHaveLength(0);

    const inv = await createInvitation(teamId, bobEmail, "engineer", alice);
    const accepted = await acceptInvitation(inv.token, bobId);
    if ("error" in accepted) throw new Error(`accept failed: ${accepted.error}`);
    expect(accepted.teamId).toBe(teamId);
    expect(await getMembership(bobId, teamId)).toBe("engineer");

    expect((await listUserOrgs(bobId)).map((o) => o.teamId)).toEqual([teamId]);
  });
});
