"use client";

import { useEffect } from "react";
import { useSessionStore } from "@/lib/stores/session.store";
import { ROLE_PERMISSIONS, type Permission, type Role } from "@/config/permissions";
import type { Session, TeamId, UserId } from "@/types/domain";

type Me = {
  user: { userId: string; email: string; name: string };
  orgs: { teamId: string; slug: string; name: string; role: string }[];
  activeOrgId: string | null;
};

/**
 * Hydrates the session store from the real engine (`/api/v1/auth/me`) for the active
 * team. When there's no session (dev without login), it leaves the seeded mock in place
 * so local development keeps rendering. Engine RBAC is the source of truth regardless.
 */
export function SessionHydrator({ team }: { team: string }) {
  const setSession = useSessionStore((s) => s.setSession);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/auth/me");
        if (!res.ok || cancelled) return;
        const me = (await res.json()) as Me;
        const active =
          me.orgs.find((o) => o.slug === team) ??
          me.orgs.find((o) => o.teamId === me.activeOrgId) ??
          me.orgs[0];
        if (!active || cancelled) return;
        const role = active.role as Role;
        const perms = ROLE_PERMISSIONS[role];
        const session: Session = {
          user: { id: me.user.userId as UserId, name: me.user.name || me.user.email, email: me.user.email },
          team: { id: active.teamId as TeamId, slug: active.slug, name: active.name },
          role,
          permissions: perms === "*" ? "*" : ([...perms] as Permission[]),
          teams: me.orgs.map((o) => ({ id: o.teamId as TeamId, slug: o.slug, name: o.name })),
        };
        setSession(session);
      } catch {
        /* keep the seeded mock */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [team, setSession]);
  return null;
}
