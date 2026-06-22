import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  acceptInvitation,
  createInvitation,
  createOrg,
  createSession,
  getMembership,
  getSessionUser,
  listUserOrgs,
  login,
  logout,
  signUp,
  verifyEmail,
} from "./auth-repo";
import { ORG_COOKIE, SESSION_COOKIE } from "./auth";
import { env } from "./env";

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
  // Surface the verify link only when dev-headers mode is on (no SMTP sender in the MVP).
  // In prod (AUTH_DEV_HEADERS=false) the link is withheld — wire a real email sender there.
  const verifyUrl = `${env.WEB_PUBLIC_URL}/verify?token=${res.verifyToken}`;
  return c.json({ user: res.user, verifyUrl: env.AUTH_DEV_HEADERS ? verifyUrl : undefined }, 201);
});

auth.post("/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  if (!body.token) return c.json({ error: "invalid_body" }, 400);
  const ok = await verifyEmail(body.token);
  return c.json({ ok }, ok ? 200 : 400);
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
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const orgs = await listUserOrgs(user.userId);
  return c.json({ user, orgs, activeOrgId: getCookie(c, ORG_COOKIE) ?? orgs[0]?.teamId ?? null });
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
