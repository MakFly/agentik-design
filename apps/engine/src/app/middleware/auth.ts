import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { roleCan, type Permission, type Role } from "@agentik/workflow-schema";
import { resolveTeam } from "../../infra/tenancy";
import { getMembership, getSessionUser, listUserOrgs } from "../../gateway/auth-repo";
import { env } from "../../infra/env";

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
 * Core tenancy resolution — used by both the HTTP middleware (`resolveAuth`) and the
 * WebSocket upgrade (`resolveAuthFromRequest`), so the two can never drift.
 * - Valid session token → derive userId, active org (org cookie or first membership), role.
 *   orgId is "" when the user has no org yet (→ onboarding).
 * - No valid session → DEV fallback to a caller-supplied slug/role, only when AUTH_DEV_HEADERS.
 */
async function resolveFromParts(opts: {
  sessionToken?: string;
  wantOrg?: string;
  devSlug: string;
  devRole?: string;
}): Promise<(AuthContext & { teamSlug: string }) | null> {
  if (opts.sessionToken) {
    const user = await getSessionUser(opts.sessionToken);
    if (user) {
      const orgs = await listUserOrgs(user.userId);
      const active = orgs.find((o) => o.teamId === opts.wantOrg) ?? orgs[0];
      if (active) {
        return { userId: user.userId, orgId: active.teamId, role: active.role as Role, teamSlug: active.slug };
      }
      // Authenticated but no org yet — safe empty tenancy until onboarding completes.
      return { userId: user.userId, orgId: "", role: "viewer", teamSlug: "" };
    }
  }
  // No valid session. Only fall back to client-supplied tenancy when explicitly allowed (dev/tests).
  if (!env.AUTH_DEV_HEADERS) return null;
  const orgId = await resolveTeam(opts.devSlug);
  return { userId: `usr_dev_${opts.devSlug}`, orgId, role: parseRole(opts.devRole), teamSlug: opts.devSlug };
}

/** Resolve caller org + role SERVER-SIDE from a Hono request context (HTTP routes). */
export async function resolveAuth(c: Context): Promise<(AuthContext & { teamSlug: string }) | null> {
  return resolveFromParts({
    sessionToken: getCookie(c, SESSION_COOKIE),
    wantOrg: getCookie(c, ORG_COOKIE),
    devSlug: c.req.header("x-team") ?? "acme",
    devRole: c.req.header("x-role"),
  });
}

/** Minimal cookie-header parser for the raw-Request (WebSocket upgrade) path. */
function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * Same tenancy resolution as `resolveAuth`, but from a raw `Request` — used by the
 * WebSocket upgrade, which has no Hono context. The session cookie is authoritative;
 * a browser WS can't set x-team, so the dev fallback reads the team from `?team=`.
 */
export async function resolveAuthFromRequest(req: Request): Promise<(AuthContext & { teamSlug: string }) | null> {
  const cookies = parseCookies(req.headers.get("cookie"));
  return resolveFromParts({
    sessionToken: cookies[SESSION_COOKIE],
    wantOrg: cookies[ORG_COOKIE],
    devSlug: new URL(req.url).searchParams.get("team") ?? req.headers.get("x-team") ?? "acme",
    devRole: req.headers.get("x-role") ?? undefined,
  });
}

/** Look up a user's role in an org for direct checks (used by auth-aware routes). */
export { getMembership };

/** Populate teamId/teamSlug/auth on the request context. */
export const withAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const resolved = await resolveAuth(c);
  if (!resolved) return c.json({ error: "unauthenticated" }, 401);
  // Authenticated but no org yet → must onboard. Never treat "" as a valid tenant.
  if (!resolved.orgId) return c.json({ error: "no_org", hint: "create or join an organization" }, 403);
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
