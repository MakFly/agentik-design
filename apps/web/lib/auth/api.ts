/**
 * Client-side auth calls. They hit the web origin's `/api/v1/auth/*`, which Next rewrites
 * to the engine (same-origin from the browser → the session cookie flows automatically).
 */

export type AuthUser = {
  userId: string;
  email: string;
  name: string;
  emailVerifiedAt?: string | null;
  onboardingQuestionnaire?: Record<string, unknown>;
};
export type Org = {
  teamId: string;
  slug: string;
  name: string;
  role: string;
  onboardingCompleted: boolean;
};

export type UiPreferences = {
  reduceMotion?: boolean;
  submitMode?: "enter" | "ctrlEnter";
  theme?: "light" | "dark" | "system";
};

export type NotificationPreferences = {
  emailRunComplete?: boolean;
  emailRunFailed?: boolean;
  emailApprovalNeeded?: boolean;
  emailInvitations?: boolean;
  inAppRuns?: boolean;
  inAppApprovals?: boolean;
  inAppMentions?: boolean;
};

import { normalizeResponse } from "@/lib/api/errors";

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1/auth/${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await normalizeResponse(res);
  return res.json() as Promise<T>;
}

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
    post<{ user: AuthUser; verifyCode?: string; verifyUrl?: string }>("signup", b),
  login: (b: { email: string; password: string }) => post<{ user: AuthUser }>("login", b),
  verify: (token: string) => post<{ ok: boolean; slug?: string; teamId?: string }>("verify", { token }),
  verifyCode: (email: string, code: string) =>
    post<{ ok: boolean; slug?: string; teamId?: string }>("verify-code", { email, code }),
  logout: () => post<{ ok: boolean }>("logout", {}),
  createOrg: (b: { name: string; slug: string }) =>
    post<{ teamId: string; slug: string; daemonToken: string }>("orgs", b),
  acceptInvite: (token: string) => post<{ teamId: string; role: string }>("invitations/accept", { token }),
  completeOnboarding: () => post<{ ok: boolean }>("onboarding/complete", {}),
  saveQuestionnaire: (answers: Record<string, unknown>) =>
    fetch(`/api/v1/auth/onboarding/questionnaire`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(answers),
    }).then(async (res) => {
      if (!res.ok) throw new Error("save_failed");
      return res.json() as Promise<{ ok: boolean }>;
    }),
  async me(): Promise<{
    user: AuthUser & {
      uiPreferences?: UiPreferences;
      notificationPreferences?: NotificationPreferences;
    };
    orgs: Org[];
    activeOrgId: string | null;
  } | null> {
    const res = await fetch(`/api/v1/auth/me`);
    if (!res.ok) return null;
    return res.json();
  },
  updateProfile: (body: {
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => patch<{ ok: boolean; user: { name: string; email: string } }>("me", body),
  updatePreferences: (body: UiPreferences) =>
    patch<{ uiPreferences: UiPreferences }>("me/preferences", body),
  updateNotifications: (body: NotificationPreferences) =>
    patch<{ notificationPreferences: NotificationPreferences }>(
      "me/notifications",
      body,
    ),
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
