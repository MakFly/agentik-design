import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "../infra/db/client";
import { genId } from "../infra/db/ids";
import type { OrgRole } from "../infra/db/schema";
import { hub } from "../infra/hub";

const {
  appUsers,
  userSessions,
  orgMembers,
  orgInvitations,
  teams,
  daemons,
  runtimes,
} = schema;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VERIFY_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function generateVerifyCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

/** Derive a default org name/slug from an email local-part. */
export function defaultOrgFromEmail(email: string) {
  const local = (email.split("@")[0] ?? "")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  const base = local.slice(0, 40) || "workspace";
  return { name: `${base}'s workspace`, slug: base };
}

function token(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain); // argon2id by default
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}

/* ── Sign-up / verify / login / session ──────────────────────────────── */

export async function signUp(input: {
  email: string;
  password: string;
  name?: string;
}) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);
  if (existing) return { error: "email_taken" as const };
  const id = genId("usr");
  const verifyToken = token();
  const verifyCode = generateVerifyCode();
  const verifyCodeExpiresAt = new Date(Date.now() + VERIFY_CODE_TTL_MS).toISOString();
  await db.insert(appUsers).values({
    id,
    email,
    passwordHash: await hashPassword(input.password),
    name: input.name ?? "",
    verifyToken,
    verifyCode,
    verifyCodeExpiresAt,
  });
  return { user: { id, email, name: input.name ?? "" }, verifyToken, verifyCode };
}

export async function verifyEmail(verifyToken: string) {
  const updated = await db
    .update(appUsers)
    .set({
      emailVerifiedAt: new Date().toISOString(),
      verifyToken: null,
      verifyCode: null,
      verifyCodeExpiresAt: null,
    })
    .where(eq(appUsers.verifyToken, verifyToken))
    .returning({ id: appUsers.id, email: appUsers.email });
  return updated[0] ?? null;
}

export async function verifyEmailCode(email: string, code: string) {
  const normalized = email.trim().toLowerCase();
  const trimmed = code.trim();
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, normalized))
    .limit(1);
  if (!user) return { error: "invalid_code" as const };
  if (user.emailVerifiedAt) {
    return { userId: user.id, email: user.email, alreadyVerified: true as const };
  }
  if (!user.verifyCode || user.verifyCode !== trimmed) {
    return { error: "invalid_code" as const };
  }
  const now = Date.now();
  if (!user.verifyCodeExpiresAt || new Date(user.verifyCodeExpiresAt).getTime() < now) {
    return { error: "code_expired" as const };
  }
  await db
    .update(appUsers)
    .set({
      emailVerifiedAt: new Date().toISOString(),
      verifyToken: null,
      verifyCode: null,
      verifyCodeExpiresAt: null,
    })
    .where(eq(appUsers.id, user.id));
  return { userId: user.id, email: user.email };
}

/** Auto-create a workspace for a newly verified user if they have no org yet. */
export async function autoProvisionOrg(userId: string, email: string) {
  const existing = await listUserOrgs(userId);
  if (existing.length > 0) {
    const first = existing[0]!;
    return { teamId: first.teamId, slug: first.slug, daemonToken: "" };
  }
  const base = defaultOrgFromEmail(email);
  for (let i = 0; i < 10; i++) {
    const slug = i === 0 ? base.slug : `${base.slug}-${i + 1}`;
    const res = await createOrg(userId, { name: base.name, slug });
    if (!("error" in res)) return res;
    if (res.error !== "slug_taken") return res;
  }
  return { error: "slug_taken" as const };
}

export async function provisionWorkspaceOnVerify(userId: string, email: string) {
  return autoProvisionOrg(userId, email);
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
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);
  if (!user) return null;
  if (!(await verifyPassword(input.password, user.passwordHash))) return null;
  if (!user.emailVerifiedAt) return { error: "email_unverified" as const };
  const session = await createSession(user.id);
  return { session, user: { id: user.id, email: user.email, name: user.name } };
}

export async function getSessionUser(sessionToken: string) {
  const nowIso = new Date().toISOString();
  const [row] = await db
    .select({
      userId: appUsers.id,
      email: appUsers.email,
      name: appUsers.name,
      emailVerifiedAt: appUsers.emailVerifiedAt,
      onboardingQuestionnaire: appUsers.onboardingQuestionnaire,
    })
    .from(userSessions)
    .innerJoin(appUsers, eq(appUsers.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.token, sessionToken),
        gt(userSessions.expiresAt, nowIso),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function logout(sessionToken: string) {
  await db.delete(userSessions).where(eq(userSessions.token, sessionToken));
}

/* ── Orgs & memberships ──────────────────────────────────────────────── */

export async function createOrg(
  userId: string,
  input: { name: string; slug: string },
) {
  const slug = input.slug.trim().toLowerCase();
  const [clash] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.slug, slug))
    .limit(1);
  if (clash) return { error: "slug_taken" as const };
  const teamId = genId("team");
  const daemonToken = token();
  await db
    .insert(teams)
    .values({ id: teamId, slug, name: input.name, daemonToken });
  await db
    .insert(orgMembers)
    .values({ id: genId("mbr"), teamId, userId, role: "owner" });
  return { teamId, slug, daemonToken };
}

export async function listUserOrgs(userId: string) {
  const rows = await db
    .select({
      teamId: teams.id,
      slug: teams.slug,
      name: teams.name,
      role: orgMembers.role,
      onboardingCompletedAt: orgMembers.onboardingCompletedAt,
    })
    .from(orgMembers)
    .innerJoin(teams, eq(teams.id, orgMembers.teamId))
    .where(eq(orgMembers.userId, userId));
  return rows.map((row) => ({
    teamId: row.teamId,
    slug: row.slug,
    name: row.name,
    role: row.role,
    onboardingCompleted: row.onboardingCompletedAt != null,
  }));
}

export async function completeOnboarding(userId: string, teamId: string) {
  const updated = await db
    .update(orgMembers)
    .set({ onboardingCompletedAt: new Date().toISOString() })
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.teamId, teamId)))
    .returning({ id: orgMembers.id });
  return updated.length > 0;
}

export async function saveOnboardingQuestionnaire(
  userId: string,
  questionnaire: Record<string, unknown>,
) {
  await db
    .update(appUsers)
    .set({ onboardingQuestionnaire: questionnaire })
    .where(eq(appUsers.id, userId));
}

/** Resolve the org (team) that owns a given org-scoped daemon token, or null. */
export async function resolveTeamByDaemonToken(
  daemonToken: string,
): Promise<string | null> {
  if (!daemonToken) return null;
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.daemonToken, daemonToken))
    .limit(1);
  return row?.id ?? null;
}

/* ── Personal (user-scoped) daemon: one local daemon serves all the user's orgs ── */

/** Roles allowed to back a runtime host. A personal machine can execute for owners/admins only. */
const DAEMON_ROLES: OrgRole[] = ["owner", "admin"];

const PERSONAL_DAEMON_PREFIX = "dtkn";

function personalDaemonToken(): string {
  return `${PERSONAL_DAEMON_PREFIX}_${token()}`;
}

function daemonTokenPrefix(t: string): string {
  return t.slice(0, 17);
}

export type UserDaemonTokenStatus = {
  hasToken: boolean;
  prefix: string | null;
  issuedAt: string | null;
};

export async function getUserDaemonTokenStatus(
  userId: string,
): Promise<UserDaemonTokenStatus | null> {
  const [user] = await db
    .select({
      daemonTokenHash: appUsers.daemonTokenHash,
      daemonTokenPrefix: appUsers.daemonTokenPrefix,
      daemonTokenIssuedAt: appUsers.daemonTokenIssuedAt,
    })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!user) return null;
  return {
    hasToken: Boolean(user.daemonTokenHash),
    prefix: user.daemonTokenPrefix ?? null,
    issuedAt: user.daemonTokenIssuedAt ?? null,
  };
}

/** Rotate and reveal the personal daemon token exactly once. */
export async function rotateUserDaemonToken(
  userId: string,
): Promise<(UserDaemonTokenStatus & { token: string }) | null> {
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!user) return null;
  const t = personalDaemonToken();
  const issuedAt = new Date().toISOString();
  const prefix = daemonTokenPrefix(t);
  await db
    .update(appUsers)
    .set({
      daemonTokenHash: await Bun.password.hash(t),
      daemonTokenPrefix: prefix,
      daemonTokenIssuedAt: issuedAt,
    })
    .where(eq(appUsers.id, userId));
  return { hasToken: true, prefix, issuedAt, token: t };
}

export async function revokeUserDaemonToken(userId: string): Promise<boolean> {
  const orgs = await listUserDaemonOrgs(userId);
  const updated = await db
    .update(appUsers)
    .set({
      daemonTokenHash: null,
      daemonTokenPrefix: null,
      daemonTokenIssuedAt: null,
    })
    .where(eq(appUsers.id, userId))
    .returning({ id: appUsers.id });
  if (updated[0] && orgs.length > 0) {
    const deleted = await db
      .delete(daemons)
      .where(
        and(
          inArray(
            daemons.teamId,
            orgs.map((o) => o.teamId),
          ),
          sql`${daemons.meta}->>'mode' = 'personal'`,
          sql`${daemons.meta}->>'userId' = ${userId}`,
        ),
      )
      .returning({ teamId: daemons.teamId });
    for (const teamId of new Set(deleted.map((d) => d.teamId))) {
      hub.publish(teamId, { kind: "presence" });
    }
  }
  return Boolean(updated[0]);
}

export async function markUserPersonalDaemonsOffline(
  userId: string,
): Promise<number> {
  const orgs = await listUserDaemonOrgs(userId);
  if (orgs.length === 0) return 0;
  const updated = await db
    .update(daemons)
    .set({ status: "offline", lastHeartbeatAt: null })
    .where(
      and(
        inArray(
          daemons.teamId,
          orgs.map((o) => o.teamId),
        ),
        sql`${daemons.meta}->>'mode' = 'personal'`,
        sql`${daemons.meta}->>'userId' = ${userId}`,
      ),
    )
    .returning({ id: daemons.id, teamId: daemons.teamId });
  if (updated.length === 0) return 0;
  await db
    .update(runtimes)
    .set({ status: "offline" })
    .where(
      inArray(
        runtimes.daemonId,
        updated.map((d) => d.id),
      ),
    );
  for (const teamId of new Set(updated.map((d) => d.teamId))) {
    hub.publish(teamId, { kind: "presence" });
  }
  return updated.length;
}

/** Resolve the user that owns a personal daemon token, or null. */
export async function resolveUserByDaemonToken(
  daemonToken: string,
): Promise<string | null> {
  if (!daemonToken) return null;
  const prefix = daemonTokenPrefix(daemonToken);
  const [row] = await db
    .select({ id: appUsers.id, daemonTokenHash: appUsers.daemonTokenHash })
    .from(appUsers)
    .where(eq(appUsers.daemonTokenPrefix, prefix))
    .limit(1);
  if (!row?.daemonTokenHash) return null;
  return (await Bun.password.verify(daemonToken, row.daemonTokenHash))
    ? row.id
    : null;
}

/** Orgs a user's personal daemon may serve. Never returns org-scoped daemon tokens. */
export async function listUserDaemonOrgs(userId: string) {
  const rows = await db
    .select({
      teamId: teams.id,
      slug: teams.slug,
      name: teams.name,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(teams, eq(teams.id, orgMembers.teamId))
    .where(eq(orgMembers.userId, userId));
  return rows
    .filter((r) => DAEMON_ROLES.includes(r.role))
    .map((r) => ({ teamId: r.teamId, slug: r.slug, name: r.name }));
}

export async function userCanRunDaemonForTeam(
  userId: string,
  teamId: string,
): Promise<boolean> {
  const role = await getMembership(userId, teamId);
  return Boolean(role && DAEMON_ROLES.includes(role));
}

export async function resolveUserDaemonTeamBySlug(
  userId: string,
  slug: string,
): Promise<string | null> {
  const rows = await listUserDaemonOrgs(userId);
  return rows.find((r) => r.slug === slug)?.teamId ?? null;
}

export async function getMembership(
  userId: string,
  teamId: string,
): Promise<OrgRole | null> {
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
  {
    email: "member@agentik.dev",
    name: "Demo Member",
    role: "engineer" as OrgRole,
  },
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
    const [existing] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, email))
      .limit(1);
    if (existing) return existing.id;
    const id = genId("usr");
    await db
      .insert(appUsers)
      .values({ id, email, name, passwordHash: hash, emailVerifiedAt: now });
    return id;
  }

  const ownerId = await ensureUser(
    DEV_ACCOUNTS[0]!.email,
    DEV_ACCOUNTS[0]!.name,
  );
  const memberId = await ensureUser(
    DEV_ACCOUNTS[1]!.email,
    DEV_ACCOUNTS[1]!.name,
  );

  // Demo org (slug "demo") owned by the owner; member joins as engineer.
  let [org] = await db
    .select()
    .from(teams)
    .where(eq(teams.slug, "demo"))
    .limit(1);
  if (!org) {
    const teamId = genId("team");
    await db.insert(teams).values({
      id: teamId,
      slug: "demo",
      name: "Demo Org",
      daemonToken: genId("usr"),
    });
    org = (
      await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
    )[0];
  }
  if (org) {
    await db
      .insert(orgMembers)
      .values([
        { id: genId("mbr"), teamId: org.id, userId: ownerId, role: "owner" },
        {
          id: genId("mbr"),
          teamId: org.id,
          userId: memberId,
          role: "engineer",
        },
      ])
      .onConflictDoNothing({ target: [orgMembers.teamId, orgMembers.userId] });
  }

  return DEV_ACCOUNTS.map((a) => ({
    email: a.email,
    password: DEV_ACCOUNT_PASSWORD,
    role: a.role,
    org: "demo",
  }));
}

/* ── Invitations ─────────────────────────────────────────────────────── */

export async function createInvitation(
  teamId: string,
  email: string,
  role: OrgRole,
  invitedBy: string,
) {
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
    .where(
      and(
        eq(orgInvitations.token, inviteToken),
        gt(orgInvitations.expiresAt, nowIso),
      ),
    )
    .limit(1);
  if (!inv || inv.acceptedAt) return { error: "invalid_invite" as const };
  // Idempotent membership (unique team+user).
  await db
    .insert(orgMembers)
    .values({
      id: genId("mbr"),
      teamId: inv.teamId,
      userId,
      role: inv.role,
      onboardingCompletedAt: new Date().toISOString(),
    })
    .onConflictDoNothing({ target: [orgMembers.teamId, orgMembers.userId] });
  await db
    .update(orgInvitations)
    .set({ acceptedAt: nowIso })
    .where(eq(orgInvitations.id, inv.id));
  return { teamId: inv.teamId, role: inv.role };
}
