import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import type { OrgRole } from "./db/schema";

const { appUsers, userSessions, orgMembers, orgInvitations, teams } = schema;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function token(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain); // argon2id by default
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}

/* ── Sign-up / verify / login / session ──────────────────────────────── */

export async function signUp(input: { email: string; password: string; name?: string }) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.email, email)).limit(1);
  if (existing) return { error: "email_taken" as const };
  const id = genId("usr");
  const verifyToken = token();
  await db.insert(appUsers).values({
    id,
    email,
    passwordHash: await hashPassword(input.password),
    name: input.name ?? "",
    verifyToken,
  });
  return { user: { id, email, name: input.name ?? "" }, verifyToken };
}

export async function verifyEmail(verifyToken: string) {
  const updated = await db
    .update(appUsers)
    .set({ emailVerifiedAt: new Date().toISOString(), verifyToken: null })
    .where(eq(appUsers.verifyToken, verifyToken))
    .returning({ id: appUsers.id });
  return Boolean(updated[0]);
}

export async function createSession(userId: string) {
  const id = genId("sess");
  const t = token();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.insert(userSessions).values({ id, userId, token: t, expiresAt });
  return { token: t, expiresAt };
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
  if (!user) return null;
  if (!(await verifyPassword(input.password, user.passwordHash))) return null;
  if (!user.emailVerifiedAt) return { error: "email_unverified" as const };
  const session = await createSession(user.id);
  return { session, user: { id: user.id, email: user.email, name: user.name } };
}

export async function getSessionUser(sessionToken: string) {
  const nowIso = new Date().toISOString();
  const [row] = await db
    .select({ userId: appUsers.id, email: appUsers.email, name: appUsers.name, emailVerifiedAt: appUsers.emailVerifiedAt })
    .from(userSessions)
    .innerJoin(appUsers, eq(appUsers.id, userSessions.userId))
    .where(and(eq(userSessions.token, sessionToken), gt(userSessions.expiresAt, nowIso)))
    .limit(1);
  return row ?? null;
}

export async function logout(sessionToken: string) {
  await db.delete(userSessions).where(eq(userSessions.token, sessionToken));
}

/* ── Orgs & memberships ──────────────────────────────────────────────── */

export async function createOrg(userId: string, input: { name: string; slug: string }) {
  const slug = input.slug.trim().toLowerCase();
  const [clash] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, slug)).limit(1);
  if (clash) return { error: "slug_taken" as const };
  const teamId = genId("team");
  const daemonToken = token();
  await db.insert(teams).values({ id: teamId, slug, name: input.name, daemonToken });
  await db.insert(orgMembers).values({ id: genId("mbr"), teamId, userId, role: "owner" });
  return { teamId, slug, daemonToken };
}

export async function listUserOrgs(userId: string) {
  return db
    .select({ teamId: teams.id, slug: teams.slug, name: teams.name, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(teams, eq(teams.id, orgMembers.teamId))
    .where(eq(orgMembers.userId, userId));
}

/** Resolve the org (team) that owns a given org-scoped daemon token, or null. */
export async function resolveTeamByDaemonToken(daemonToken: string): Promise<string | null> {
  if (!daemonToken) return null;
  const [row] = await db.select({ id: teams.id }).from(teams).where(eq(teams.daemonToken, daemonToken)).limit(1);
  return row?.id ?? null;
}

export async function getMembership(userId: string, teamId: string): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.teamId, teamId)))
    .limit(1);
  return row?.role ?? null;
}

/* ── Dev quick-login accounts (dev only — gated by the route) ────────── */

/** Shared password for the seeded demo accounts. Dev convenience only. */
export const DEV_ACCOUNT_PASSWORD = "agentik-demo";

const DEV_ACCOUNTS = [
  { email: "owner@agentik.dev", name: "Demo Owner", role: "owner" as OrgRole },
  { email: "member@agentik.dev", name: "Demo Member", role: "engineer" as OrgRole },
];

/**
 * Idempotently ensure a couple of verified demo accounts exist (an owner + a member of a
 * shared "Demo Org"), so dev one-click login works. Returns email + the known password.
 * NEVER expose in production — the calling route gates this on AUTH_DEV_HEADERS.
 */
export async function ensureDevAccounts() {
  const now = new Date().toISOString();
  const hash = await hashPassword(DEV_ACCOUNT_PASSWORD);

  async function ensureUser(email: string, name: string) {
    const [existing] = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
    if (existing) return existing.id;
    const id = genId("usr");
    await db.insert(appUsers).values({ id, email, name, passwordHash: hash, emailVerifiedAt: now });
    return id;
  }

  const ownerId = await ensureUser(DEV_ACCOUNTS[0]!.email, DEV_ACCOUNTS[0]!.name);
  const memberId = await ensureUser(DEV_ACCOUNTS[1]!.email, DEV_ACCOUNTS[1]!.name);

  // Demo org (slug "demo") owned by the owner; member joins as engineer.
  let [org] = await db.select().from(teams).where(eq(teams.slug, "demo")).limit(1);
  if (!org) {
    const teamId = genId("team");
    await db.insert(teams).values({ id: teamId, slug: "demo", name: "Demo Org", daemonToken: genId("usr") });
    org = (await db.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0];
  }
  if (org) {
    await db
      .insert(orgMembers)
      .values([
        { id: genId("mbr"), teamId: org.id, userId: ownerId, role: "owner" },
        { id: genId("mbr"), teamId: org.id, userId: memberId, role: "engineer" },
      ])
      .onConflictDoNothing({ target: [orgMembers.teamId, orgMembers.userId] });
  }

  return DEV_ACCOUNTS.map((a) => ({ email: a.email, password: DEV_ACCOUNT_PASSWORD, role: a.role, org: "demo" }));
}

/* ── Invitations ─────────────────────────────────────────────────────── */

export async function createInvitation(teamId: string, email: string, role: OrgRole, invitedBy: string) {
  const id = genId("inv");
  const t = token();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await db.insert(orgInvitations).values({
    id,
    teamId,
    email: email.trim().toLowerCase(),
    role,
    token: t,
    invitedBy,
    expiresAt,
  });
  return { id, token: t, expiresAt };
}

export async function acceptInvitation(inviteToken: string, userId: string) {
  const nowIso = new Date().toISOString();
  const [inv] = await db
    .select()
    .from(orgInvitations)
    .where(and(eq(orgInvitations.token, inviteToken), gt(orgInvitations.expiresAt, nowIso)))
    .limit(1);
  if (!inv || inv.acceptedAt) return { error: "invalid_invite" as const };
  // Idempotent membership (unique team+user).
  await db
    .insert(orgMembers)
    .values({ id: genId("mbr"), teamId: inv.teamId, userId, role: inv.role })
    .onConflictDoNothing({ target: [orgMembers.teamId, orgMembers.userId] });
  await db.update(orgInvitations).set({ acceptedAt: nowIso }).where(eq(orgInvitations.id, inv.id));
  return { teamId: inv.teamId, role: inv.role };
}
