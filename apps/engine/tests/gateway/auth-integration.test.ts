/**
 * Auth + org tenancy integration tests against a REAL Postgres. Skip when no DB reachable.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./infra/db/client";
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
  provisionWorkspaceOnVerify,
  resolveUserByDaemonToken,
  revokeUserDaemonToken,
  rotateUserDaemonToken,
  signUp,
  verifyEmail,
  verifyEmailCode,
  completeOnboarding,
} from "./gateway/auth-repo";

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
  let aliceId = "";
  let bobId = "";
  let acmeTeamId = "";

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
    aliceId = res.user.id;
    const [row] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, aliceEmail))
      .limit(1);
    expect(row?.passwordHash).not.toBe("supersecret1"); // hashed
    expect(res.verifyCode).toMatch(/^\d{6}$/);
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
    const verified = await verifyEmail(row!.verifyToken!);
    expect(verified?.email).toBe(aliceEmail);
    const [after] = await db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.email, aliceEmail))
      .limit(1);
    expect(after?.emailVerifiedAt).not.toBeNull();
    expect(after?.verifyCode).toBeNull();
  });

  test("OTP verify auto-provisions workspace", async () => {
    const otpEmail = `otp-${stamp}@test.dev`;
    const signup = await signUp({
      email: otpEmail,
      password: "supersecret1",
      name: "OTP User",
    });
    if ("error" in signup) throw new Error(`signup failed: ${signup.error}`);
    userIds.push(signup.user.id);
    expect(signup.verifyCode).toMatch(/^\d{6}$/);

    const verified = await verifyEmailCode(otpEmail, signup.verifyCode);
    if ("error" in verified) throw new Error(`verify failed: ${verified.error}`);
    expect(verified.userId).toBe(signup.user.id);

    const org = await provisionWorkspaceOnVerify(verified.userId, otpEmail);
    if ("error" in org) throw new Error(`provision failed: ${org.error}`);
    teamIds.push(org.teamId);
    expect(org.slug).toMatch(/^otp-\d+$/);
    const orgs = await listUserOrgs(verified.userId);
    expect(orgs.length).toBe(1);
    expect(orgs[0]?.onboardingCompleted).toBe(false);
    expect(await completeOnboarding(verified.userId, org.teamId)).toBe(true);
    expect((await listUserOrgs(verified.userId))[0]?.onboardingCompleted).toBe(true);
  });

  test("after verification, login issues a working session", async () => {
    const ok = await login({ email: aliceEmail, password: "supersecret1" });
    if (!ok || "error" in ok) throw new Error("verified login should succeed");
    const user = await getSessionUser(ok.session.token);
    expect(user?.email).toBe(aliceEmail);
    expect(await getSessionUser("garbage-token")).toBeNull();
  });

  test("create org → owner membership + org-scoped daemon token", async () => {
    const org = await createOrg(aliceId, {
      name: "Acme Co",
      slug: `acme-${stamp}`,
    });
    if ("error" in org) throw new Error(`createOrg failed: ${org.error}`);
    teamIds.push(org.teamId);
    acmeTeamId = org.teamId;
    expect(org.daemonToken).toBeTruthy();
    expect(await getMembership(aliceId, org.teamId)).toBe("owner");
  });

  test("invite a second user → accept → membership; orgs stay isolated", async () => {
    const bob = await signUp({
      email: bobEmail,
      password: "bobsecret12",
      name: "Bob",
    });
    if ("error" in bob) throw new Error("bob signup failed");
    bobId = bob.user.id;
    userIds.push(bobId);

    // Bob is in no orgs yet (isolation).
    expect(await listUserOrgs(bobId)).toHaveLength(0);

    const inv = await createInvitation(acmeTeamId, bobEmail, "engineer", aliceId);
    const accepted = await acceptInvitation(inv.token, bobId);
    if ("error" in accepted)
      throw new Error(`accept failed: ${accepted.error}`);
    expect(accepted.teamId).toBe(acmeTeamId);
    expect(await getMembership(bobId, acmeTeamId)).toBe("engineer");

    expect((await listUserOrgs(bobId)).map((o) => o.teamId)).toEqual([acmeTeamId]);
  });

  test("personal daemon token is revealed once, resolves by hash, and can be revoked", async () => {
    const before = await getUserDaemonTokenStatus(aliceId);
    expect(before?.hasToken).toBe(false);

    const rotated = await rotateUserDaemonToken(aliceId);
    expect(rotated?.token.startsWith("dtkn_")).toBe(true);
    expect(rotated?.prefix).toBe(rotated!.token.slice(0, 17));

    const status = await getUserDaemonTokenStatus(aliceId);
    expect(status?.hasToken).toBe(true);
    expect(status).not.toHaveProperty("token");

    expect(await resolveUserByDaemonToken(rotated!.token)).toBe(aliceId);
    expect(await resolveUserByDaemonToken(`${rotated!.token}x`)).toBeNull();

    const daemonId = `dmon_${stamp}`;
    const runtimeId = `rt_${stamp}`;
    await db.insert(schema.daemons).values({
      id: daemonId,
      teamId: acmeTeamId,
      name: "Alice laptop",
      meta: { mode: "personal", userId: aliceId },
    });
    await db.insert(schema.runtimes).values({
      id: runtimeId,
      daemonId,
      teamId: acmeTeamId,
      kind: "claude",
    });

    expect(await revokeUserDaemonToken(aliceId)).toBe(true);
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
    expect((await listUserDaemonOrgs(aliceId)).map((o) => o.teamId)).toContain(
      acmeTeamId,
    );
    expect(await listUserDaemonOrgs(bobId)).toEqual([]);
  });
});
