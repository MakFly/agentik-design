/**
 * RBAC model — `permission = resource:action`.
 * The frontend enforces UX; the backend enforces truth (docs/03 §7.8).
 */

export const RESOURCES = [
  "agent",
  "workflow",
  "run",
  "tool",
  "memory",
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
    "eval:read", "eval:create", "eval:update", "eval:delete",
    "settings:read", "audit:read", "billing:read",
  ],
  engineer: [
    "agent:read", "agent:create", "agent:update", "agent:delete",
    "workflow:read", "workflow:create", "workflow:update", "workflow:delete",
    "run:read", "run:create", "run:run", "run:control",
    "tool:read",
    "memory:read", "memory:create", "memory:update",
    "eval:read", "eval:create", "eval:update",
  ],
  operator: [
    "agent:read",
    "workflow:read",
    "run:read", "run:create", "run:run", "run:control", "run:approve",
    "tool:read",
    "memory:read",
    "eval:read",
  ],
  viewer: [
    "agent:read",
    "workflow:read",
    "run:read",
    "tool:read",
    "memory:read",
    "eval:read",
  ],
};

export function roleCan(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (perms === "*") return true;
  return perms.includes(permission);
}
