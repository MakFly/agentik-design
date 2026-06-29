import type { AuthUser, Org } from "./api";

export type MeResponse = {
  user: AuthUser;
  orgs: Org[];
  activeOrgId: string | null;
};

/** Resolve where to send the user right after login / verify. */
export function postAuthDestination(me: MeResponse): string {
  if (!me.user.emailVerifiedAt) return "/verify?pending=1";
  const active = me.orgs.find((o) => o.teamId === me.activeOrgId) ?? me.orgs[0];
  if (!active) return "/login";
  return `/${active.slug}/projects`;
}

/** Active org from a /me payload. */
export function activeOrg(me: MeResponse) {
  return me.orgs.find((o) => o.teamId === me.activeOrgId) ?? me.orgs[0] ?? null;
}
