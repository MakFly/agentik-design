/**
 * Client-side auth calls. They hit the web origin's `/api/v1/auth/*`, which Next rewrites
 * to the engine (same-origin from the browser → the session cookie flows automatically).
 */

export type AuthUser = { userId: string; email: string; name: string };
export type Org = { teamId: string; slug: string; name: string; role: string };

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? `request_failed_${res.status}`);
  return data as T;
}

export const authApi = {
  signup: (b: { email: string; password: string; name?: string }) =>
    post<{ user: AuthUser; verifyUrl?: string }>("signup", b),
  login: (b: { email: string; password: string }) => post<{ user: AuthUser }>("login", b),
  verify: (token: string) => post<{ ok: boolean }>("verify", { token }),
  logout: () => post<{ ok: boolean }>("logout", {}),
  createOrg: (b: { name: string; slug: string }) =>
    post<{ teamId: string; slug: string; daemonToken: string }>("orgs", b),
  acceptInvite: (token: string) => post<{ teamId: string; role: string }>("invitations/accept", { token }),
  async me(): Promise<{ user: AuthUser; orgs: Org[]; activeOrgId: string | null } | null> {
    const res = await fetch(`/api/v1/auth/me`);
    if (!res.ok) return null;
    return res.json();
  },
  /** DEV ONLY: seeded demo accounts for one-click login (empty in production). */
  async devUsers(): Promise<{ email: string; password: string; role: string; org: string }[]> {
    const res = await fetch(`/api/v1/auth/dev/users`);
    if (!res.ok) return [];
    const d = (await res.json()) as { items?: { email: string; password: string; role: string; org: string }[] };
    return d.items ?? [];
  },
};

/** Slugify an org name for the slug field default. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
