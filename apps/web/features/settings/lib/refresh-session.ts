import { authApi } from "@/lib/auth/api";
import { useSessionStore } from "@/lib/stores/session.store";
import {
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from "@/config/permissions";
import type { Session, TeamId, UserId } from "@/types/domain";

/**
 * Re-fetch the current user/team and rehydrate the session store. Called after
 * profile or workspace mutations so RBAC, slug and display name stay in sync.
 */
export async function refreshSession(team: string) {
  const me = await authApi.me();
  if (!me) return;
  const active =
    me.orgs.find((o) => o.slug === team) ??
    me.orgs.find((o) => o.teamId === me.activeOrgId) ??
    me.orgs[0];
  if (!active) return;
  const role = active.role as Role;
  const perms = ROLE_PERMISSIONS[role];
  const session: Session = {
    user: {
      id: me.user.userId as UserId,
      name: me.user.name || me.user.email,
      email: me.user.email,
    },
    team: { id: active.teamId as TeamId, slug: active.slug, name: active.name },
    role,
    permissions: perms === "*" ? "*" : ([...perms] as Permission[]),
    teams: me.orgs.map((o) => ({
      id: o.teamId as TeamId,
      slug: o.slug,
      name: o.name,
    })),
    onboardingCompleted: active.onboardingCompleted,
  };
  useSessionStore.getState().setSession(session);
}
