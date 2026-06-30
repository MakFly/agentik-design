import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  acceptInvitation,
  completeOnboarding,
  createInvitation,
  createOrg,
  createSession,
  ensureDevAccounts,
  getMembership,
  getSessionUser,
  listUserOrgs,
  login,
  logout,
  provisionWorkspaceOnVerify,
  saveOnboardingQuestionnaire,
  signUp,
  verifyEmail,
  verifyEmailCode,
} from "../auth-repo";
import {
  changeUserPassword,
  getUserAccountSettings,
  updateUserProfile,
  updateUserUiPreferences,
  type UiPreferences,
} from "../../domains/settings/repo";
import { ORG_COOKIE, SESSION_COOKIE } from "../../app/middleware/auth";
import { env } from "../../infra/env";
import { isSolo } from "../../infra/mode";
import { soloUser } from "../../infra/solo-seed";

export const auth = new Hono();

const isProd = process.env.NODE_ENV === "production";
const sessionCookieOpts = { httpOnly: true, sameSite: "Lax" as const, path: "/", secure: isProd, maxAge: 30 * 24 * 60 * 60 };

const signupBody = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().optional() });
const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const orgBody = z.object({ name: z.string().min(1), slug: z.string().min(1).regex(/^[a-z0-9-]+$/) });
const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "engineer", "operator", "viewer"]).default("viewer"),
});
const verifyCodeBody = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(6),
});
const profileBody = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),
  })
  .refine((d) => !d.newPassword || d.currentPassword, {
    message: "Current password is required to set a new password",
    path: ["currentPassword"],
  });
const uiPrefsBody = z.object({
  reduceMotion: z.boolean().optional(),
  submitMode: z.enum(["enter", "ctrlEnter"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});

/** Resolve the logged-in user from the session cookie, or null. */
async function currentUser(c: Context) {
  const t = getCookie(c, SESSION_COOKIE);
  if (!t) return null;
  return getSessionUser(t);
}

auth.post("/signup", async (c) => {
  const parsed = signupBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const res = await signUp(parsed.data);
  if ("error" in res) return c.json({ error: res.error }, 409);
  // Identify the new (still-unverified) user with a session so onboarding can resume after
  // verification — but org creation & re-login require a verified email (enforced below).
  const session = await createSession(res.user.id);
  setCookie(c, SESSION_COOKIE, session.token, sessionCookieOpts);
  const verifyUrl = `${env.WEB_PUBLIC_URL}/verify?token=${res.verifyToken}`;
  return c.json(
    {
      user: res.user,
      verifyCode: env.AUTH_DEV_HEADERS ? res.verifyCode : undefined,
      verifyUrl: env.AUTH_DEV_HEADERS ? verifyUrl : undefined,
    },
    201,
  );
});

/** DEV ONLY: ensure + list demo accounts (email + password) for one-click login. */
auth.get("/dev/users", async (c) => {
  if (!env.AUTH_DEV_HEADERS) return c.json({ items: [] });
  const items = await ensureDevAccounts();
  return c.json({ items });
});

auth.post("/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  if (!body.token) return c.json({ error: "invalid_body" }, 400);
  const verified = await verifyEmail(body.token);
  if (!verified) return c.json({ ok: false }, 400);
  const org = await provisionWorkspaceOnVerify(verified.id, verified.email);
  if ("error" in org) return c.json({ error: org.error }, 409);
  setCookie(c, ORG_COOKIE, org.teamId, { ...sessionCookieOpts, httpOnly: false });
  return c.json({ ok: true, slug: org.slug, teamId: org.teamId });
});

auth.post("/verify-code", async (c) => {
  const parsed = verifyCodeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const res = await verifyEmailCode(parsed.data.email, parsed.data.code);
  if ("error" in res) return c.json({ error: res.error }, 400);
  const org = await provisionWorkspaceOnVerify(res.userId, res.email);
  if ("error" in org) return c.json({ error: org.error }, 409);
  setCookie(c, ORG_COOKIE, org.teamId, { ...sessionCookieOpts, httpOnly: false });
  return c.json({ ok: true, slug: org.slug, teamId: org.teamId });
});

auth.post("/login", async (c) => {
  const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const res = await login(parsed.data);
  if (!res) return c.json({ error: "invalid_credentials" }, 401);
  if ("error" in res) return c.json({ error: res.error }, 403); // email_unverified
  setCookie(c, SESSION_COOKIE, res.session.token, sessionCookieOpts);
  return c.json({ user: res.user });
});

auth.post("/logout", async (c) => {
  const t = getCookie(c, SESSION_COOKIE);
  if (t) await logout(t);
  setCookie(c, SESSION_COOKIE, "", { ...sessionCookieOpts, maxAge: 0 });
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  // Solo mode is single-user and local: no session cookie is required, the seeded
  // local user is the operator. Platform keeps strict session auth.
  const user = (await currentUser(c)) ?? (isSolo ? await soloUser() : null);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const [orgs, account] = await Promise.all([
    listUserOrgs(user.userId),
    getUserAccountSettings(user.userId),
  ]);
  return c.json({
    user: {
      userId: user.userId,
      email: user.email,
      name: user.name,
      emailVerifiedAt: user.emailVerifiedAt,
      uiPreferences: account?.uiPreferences ?? {},
    },
    orgs,
    activeOrgId: getCookie(c, ORG_COOKIE) ?? orgs[0]?.teamId ?? null,
  });
});

auth.patch("/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const parsed = profileBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  }
  const { name, currentPassword, newPassword } = parsed.data;
  if (name !== undefined) {
    const res = await updateUserProfile(user.userId, name);
    if ("error" in res) return c.json({ error: res.error }, 400);
  }
  if (newPassword !== undefined) {
    if (!currentPassword) return c.json({ error: "current_password_required" }, 400);
    const res = await changeUserPassword(user.userId, currentPassword, newPassword);
    if ("error" in res) {
      const status = res.error === "invalid_password" ? 401 : 400;
      return c.json({ error: res.error }, status);
    }
  }
  const account = await getUserAccountSettings(user.userId);
  return c.json({ ok: true, user: account });
});

auth.patch("/me/preferences", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const parsed = uiPrefsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  }
  const res = await updateUserUiPreferences(user.userId, parsed.data as UiPreferences);
  if ("error" in res) return c.json({ error: res.error }, 404);
  return c.json(res);
});

auth.post("/onboarding/complete", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const orgs = await listUserOrgs(user.userId);
  const teamId = getCookie(c, ORG_COOKIE) ?? orgs[0]?.teamId;
  if (!teamId) return c.json({ error: "no_org" }, 400);
  const ok = await completeOnboarding(user.userId, teamId);
  if (!ok) return c.json({ error: "not_a_member" }, 403);
  return c.json({ ok: true });
});

auth.patch("/onboarding/questionnaire", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
  await saveOnboardingQuestionnaire(user.userId, body);
  return c.json({ ok: true });
});

auth.post("/orgs", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  // Guideline flow: sign-up → verify → create org. No org until the email is verified.
  if (!user.emailVerifiedAt) return c.json({ error: "email_unverified" }, 403);
  const parsed = orgBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const res = await createOrg(user.userId, parsed.data);
  if ("error" in res) return c.json({ error: res.error }, 409);
  setCookie(c, ORG_COOKIE, res.teamId, { ...sessionCookieOpts, httpOnly: false });
  return c.json(res, 201);
});

auth.post("/orgs/:teamId/invitations", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const teamId = c.req.param("teamId");
  const role = await getMembership(user.userId, teamId);
  if (role !== "owner" && role !== "admin") return c.json({ error: "forbidden" }, 403);
  const parsed = inviteBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const inv = await createInvitation(teamId, parsed.data.email, parsed.data.role, user.userId);
  const acceptUrl = `${env.WEB_PUBLIC_URL}/invite?token=${inv.token}`;
  return c.json({ id: inv.id, expiresAt: inv.expiresAt, acceptUrl }, 201);
});

auth.post("/invitations/accept", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  if (!body.token) return c.json({ error: "invalid_body" }, 400);
  const res = await acceptInvitation(body.token, user.userId);
  if ("error" in res) return c.json({ error: res.error }, 400);
  setCookie(c, ORG_COOKIE, res.teamId, { ...sessionCookieOpts, httpOnly: false });
  return c.json(res);
});
