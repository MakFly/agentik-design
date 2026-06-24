"use client";

import type { ReactNode } from "react";
import { useSessionStore } from "@/lib/stores/session.store";
import { roleCan, type Permission, type Role } from "@/config/permissions";

export interface Rbac {
  can: (permission: Permission) => boolean;
  role: Role;
}

export function useRbac(): Rbac {
  const session = useSessionStore((s) => s.session);
  const can = (permission: Permission): boolean => {
    if (!session) return false;
    if (session.permissions === "*") return true;
    if (session.permissions.includes(permission)) return true;
    return roleCan(session.role, permission);
  };
  return { can, role: session?.role ?? "viewer" };
}

export interface RbacGateProps {
  permission: Permission;
  children: ReactNode;
  /** rendered when the user lacks the permission (default: nothing) */
  fallback?: ReactNode;
}

/**
 * Renders children only if the active session holds `permission`.
 * The backend still enforces truth — this is UX gating (docs/03 §7.8).
 */
export function RbacGate({ permission, children, fallback = null }: RbacGateProps) {
  const { can } = useRbac();
  return <>{can(permission) ? children : fallback}</>;
}
