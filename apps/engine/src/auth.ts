import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { roleCan, type Permission, type Role } from "@agentik/workflow-schema";
import { resolveTeam } from "./repo";
import { getMembership, getSessionUser, listUserOrgs } from "./auth-repo";
import { env } from "./env";

export const SESSION_COOKIE = "agentik_session";
export const ORG_COOKIE = "agentik_org";

/**
 * Auth context derived SERVER-SIDE (never trusted from the client for tenancy).
 * One org = one team, so orgId === teamId.
 *
 * Phase 0 swap seam: today a DEV resolver reads x-team/x-role headers so existing
 * flows keep working. When better-auth (org plugin) lands, ONLY `resolveAuth` changes
 * to read the verified session — routes and the RBAC matrix stay put.
 */
export type AuthContext = {
  userId: string;
  orgId: string; // === teamId
  role: Role;
};

export type AuthVars = { teamId: string; teamSlug: string; auth: AuthContext };

const DEV_ROLE_FALLBACK: Role = "owner";

function parseRole(raw: string | undefined): Role {
  switch (raw) {
    case "owner":
    case "admin":
    case "engineer":
    case "operator":
    case "viewer":
      return raw;
    default:
      return DEV_ROLE_FALLBACK;
  }
}

/**
 * Resolve caller org + role SERVER-SIDE.
 * - Real session cookie present → derive userId, active org (org cookie or first membership),
 *   and role from the membership. orgId is "" when the user has no org yet (→ onboarding).
 * - No session cookie → DEV fallback to x-team/x-role headers (local dev & header-based tests).
 */
export async function resolveAuth(c: Context): Promise<(AuthContext & { teamSlug: string }) | null> {
  const sessionToken = getCookie(c, SESSION_COOKIE);
  if (sessionToken) {
    const user = await getSessionUser(sessionToken);
    if (user) {
      const orgs = await listUserOrgs(user.userId);
      const wantOrg = getCookie(c, ORG_COOKIE);
      const active = orgs.find((o) => o.teamId === wantOrg) ?? orgs[0];
      if (active) {
        return { userId: user.userId, orgId: active.teamId, role: active.role as Role, teamSlug: active.slug };
      }
      // Authenticated but no org yet — safe empty tenancy until onboarding completes.
      return { userId: user.userId, orgId: "", role: "viewer", teamSlug: "" };
    }
  }
  // No valid session. Only fall back to client headers when explicitly allowed (dev/tests).
  if (!env.AUTH_DEV_HEADERS) return null;
  const slug = c.req.header("x-team") ?? "acme";
  const orgId = await resolveTeam(slug);
  const role = parseRole(c.req.header("x-role"));
  return { userId: `usr_dev_${slug}`, orgId, role, teamSlug: slug };
}

/** Look up a user's role in an org for direct checks (used by auth-aware routes). */
export { getMembership };

/** Populate teamId/teamSlug/auth on the request context. */
export const withAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const resolved = await resolveAuth(c);
  if (!resolved) return c.json({ error: "unauthenticated" }, 401);
  const { teamSlug, ...auth } = resolved;
  c.set("teamSlug", teamSlug);
  c.set("teamId", auth.orgId);
  c.set("auth", auth);
  await next();
};

/** 403 if the caller's role lacks `permission`. RBAC enforced on the engine, not just the UI. */
export function requirePermission(
  permission: Permission,
): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth || !roleCan(auth.role, permission)) {
      return c.json({ error: "forbidden", permission }, 403);
    }
    await next();
  };
}
