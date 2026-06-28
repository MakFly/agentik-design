/**
 * Integration test: sensitive settings mutations write an audit_log entry.
 * Runs against a REAL Postgres and skips automatically when no DB is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { createOrg, signUp } from "../../../src/gateway/auth-repo";
import { inviteTeamMember, updateProvidersPolicy } from "../../../src/domains/settings/repo";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[audit] no DB reachable - skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("audit trail on sensitive settings mutations", () => {
  let teamId: string;
  let ownerId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const signup = await signUp({
      email: `audit-${stamp}@test.dev`,
      password: "supersecret1",
      name: "Audit Owner",
    });
    if ("error" in signup) throw new Error(`signup failed: ${signup.error}`);
    ownerId = signup.user.id;
    const org = await createOrg(ownerId, { name: "Audit Co", slug: `audit-${stamp}` });
    if ("error" in org) throw new Error(`createOrg failed: ${org.error}`);
    teamId = org.teamId;
  });

  afterAll(async () => {
    await db.delete(schema.auditLog).where(eq(schema.auditLog.teamId, teamId));
    await db.delete(schema.orgMembers).where(eq(schema.orgMembers.teamId, teamId));
    await db.delete(schema.orgInvitations).where(eq(schema.orgInvitations.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
    await db.delete(schema.appUsers).where(eq(schema.appUsers.id, ownerId));
  });

  async function auditFor(action: string) {
    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.teamId, teamId), eq(schema.auditLog.action, action)))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1);
    return row;
  }

  test("updating the spend limit writes an audit entry with actor + metadata", async () => {
    const res = await updateProvidersPolicy(teamId, ownerId, {
      monthlySpendLimitCents: 5000,
    });
    expect("error" in res).toBe(false);

    const row = await auditFor("settings.providers_policy.update");
    expect(row).toBeTruthy();
    expect(row!.actorId).toBe(ownerId);
    expect(row!.targetType).toBe("team");
    expect((row!.metadata as { monthlySpendLimitCents?: number }).monthlySpendLimitCents).toBe(5000);
  });

  test("inviting a member writes a member.invite audit entry (no secret leaked)", async () => {
    const res = await inviteTeamMember(teamId, ownerId, `invitee-${stamp}@test.dev`, "viewer");
    expect("error" in res).toBe(false);

    const row = await auditFor("member.invite");
    expect(row).toBeTruthy();
    expect(row!.actorId).toBe(ownerId);
    expect(JSON.stringify(row!.metadata)).not.toContain("password");
  });
});
