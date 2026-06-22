/**
 * RBAC model — `permission = resource:action`. Shared contract so web and engine
 * enforce the SAME matrix (web gates UX; engine enforces truth). Source of truth lives
 * here; apps/web/config/permissions.ts re-exports it for back-compat.
 */

export const RESOURCES = [
  "agent",
  "workflow",
  "run",
  "tool",
  "memory",
  "skill",
  "review",
  "eval",
  "settings",
  "billing",
  "audit",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "run",
  "approve",
  "control",
] as const;
export type Action = (typeof ACTIONS)[number];

export type Permission = `${Resource}:${Action}`;

export type Role = "owner" | "admin" | "engineer" | "operator" | "viewer";

export const ROLES: Role[] = ["owner", "admin", "engineer", "operator", "viewer"];

/** "*" means all permissions (owner). Otherwise an explicit least-privilege set. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[] | "*"> = {
  owner: "*",
  admin: [
    "agent:read", "agent:create", "agent:update", "agent:delete",
    "workflow:read", "workflow:create", "workflow:update", "workflow:delete",
    "run:read", "run:create", "run:run", "run:control", "run:approve",
    "tool:read", "tool:create", "tool:update", "tool:delete",
    "memory:read", "memory:create", "memory:update", "memory:delete",
    "skill:read", "skill:create", "skill:update", "skill:delete",
    "review:read", "review:approve",
    "eval:read", "eval:create", "eval:update", "eval:delete",
    "settings:read", "audit:read", "billing:read",
  ],
  engineer: [
    "agent:read", "agent:create", "agent:update", "agent:delete",
    "workflow:read", "workflow:create", "workflow:update", "workflow:delete",
    "run:read", "run:create", "run:run", "run:control",
    "tool:read",
    "memory:read", "memory:create", "memory:update",
    "skill:read", "skill:create", "skill:update",
    "review:read",
    "eval:read", "eval:create", "eval:update",
  ],
  operator: [
    "agent:read",
    "workflow:read",
    "run:read", "run:create", "run:run", "run:control", "run:approve",
    "tool:read",
    "memory:read",
    "skill:read",
    "review:read", "review:approve",
    "eval:read",
  ],
  viewer: [
    "agent:read",
    "workflow:read",
    "run:read",
    "tool:read",
    "memory:read",
    "skill:read",
    "review:read",
    "eval:read",
  ],
};

export function roleCan(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (perms === "*") return true;
  return perms.includes(permission);
}
