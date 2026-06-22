/**
 * RBAC model — `permission = resource:action`.
 * The frontend enforces UX; the backend enforces truth (docs/03 §7.8).
 *
 * The model now lives in the shared contract package so web and engine enforce the
 * SAME matrix. This file re-exports it for back-compat with existing `@/config/permissions`
 * imports.
 */
export {
  RESOURCES,
  ACTIONS,
  ROLES,
  ROLE_PERMISSIONS,
  roleCan,
} from "@agentik/workflow-schema";
export type {
  Resource,
  Action,
  Permission,
  Role,
} from "@agentik/workflow-schema";
