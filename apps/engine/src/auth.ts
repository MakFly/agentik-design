import type { Context, MiddlewareHandler } from "hono";
import { roleCan, type Permission, type Role } from "@agentik/workflow-schema";
import { resolveTeam } from "./repo";

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

/** Resolve caller org + role. DEV: headers. PROD (Phase 0): better-auth session. */
export async function resolveAuth(c: Context): Promise<AuthContext & { teamSlug: string }> {
  const slug = c.req.header("x-team") ?? "acme";
  const orgId = await resolveTeam(slug);
  const role = parseRole(c.req.header("x-role"));
  return { userId: `usr_dev_${slug}`, orgId, role, teamSlug: slug };
}

/** Populate teamId/teamSlug/auth on the request context. */
export const withAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const { teamSlug, ...auth } = await resolveAuth(c);
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
