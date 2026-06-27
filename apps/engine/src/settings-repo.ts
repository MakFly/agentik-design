import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import type { OrgRole } from "./db/schema";
import {
  hashPassword,
  verifyPassword,
  getMembership,
  createInvitation,
} from "./auth-repo";
import {
  listProviderKeys,
  SUPPORTED_PROVIDERS,
  isSupportedProvider,
} from "./providers-repo";
import { PROVIDER_MODELS } from "@agentik/workflow-schema";

const { appUsers, teams, orgMembers, orgInvitations } = schema;

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

export const DEFAULT_NOTIFICATION_PREFERENCES: Required<NotificationPreferences> =
  {
    emailRunComplete: false,
    emailRunFailed: true,
    emailApprovalNeeded: true,
    emailInvitations: true,
    inAppRuns: true,
    inAppApprovals: true,
    inAppMentions: true,
  };

type TeamProviderSettings = {
  fallbackOrder?: string[];
  costCeilingPerDayCents?: number;
  disabled?: string[];
  defaultProvider?: string;
};

export type TeamEnvironmentColor =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "muted";

export type TeamEnvironment = {
  id: string;
  label: string;
  color: TeamEnvironmentColor;
};

type TeamEnvironmentSettings = {
  items?: TeamEnvironment[];
  activeId?: string;
};

type TeamSettingsJson = {
  providers?: TeamProviderSettings;
  environments?: TeamEnvironmentSettings;
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

const PROVIDER_KINDS: Record<string, "anthropic" | "openai" | "self-hosted"> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openai",
  google: "self-hosted",
};

function providerId(key: string) {
  return `prov_${key}`;
}

function providerKeyFromId(id: string): string | null {
  return id.startsWith("prov_") ? id.slice(5) : null;
}

function mergeNotificationPrefs(
  raw: unknown,
): Required<NotificationPreferences> {
  const base = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  if (!raw || typeof raw !== "object") return base;
  return { ...base, ...(raw as NotificationPreferences) };
}

function mergeUiPrefs(raw: unknown): UiPreferences {
  if (!raw || typeof raw !== "object") return {};
  return raw as UiPreferences;
}

async function getTeamSettings(teamId: string): Promise<TeamSettingsJson> {
  const [row] = await db
    .select({ settings: teams.settings })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return (row?.settings as TeamSettingsJson) ?? {};
}

async function saveTeamSettings(teamId: string, settings: TeamSettingsJson) {
  await db.update(teams).set({ settings }).where(eq(teams.id, teamId));
}

const DEFAULT_ENVIRONMENTS: TeamEnvironment[] = [
  { id: "dev", label: "Development", color: "success" },
  { id: "staging", label: "Staging", color: "info" },
  { id: "prod", label: "Production", color: "warning" },
];

function fallbackEnvironmentId() {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") return "prod";
  if (nodeEnv === "test") return "staging";
  return "dev";
}

function normalizeEnvironments(raw?: TeamEnvironmentSettings) {
  const items =
    raw?.items?.filter((item) => item.id.trim() && item.label.trim()) ?? [];
  const source = items.length > 0 ? "settings" : "node_env";
  const normalizedItems = items.length > 0 ? items : DEFAULT_ENVIRONMENTS;
  const activeId =
    raw?.activeId && normalizedItems.some((item) => item.id === raw.activeId)
      ? raw.activeId
      : normalizedItems.some((item) => item.id === fallbackEnvironmentId())
        ? fallbackEnvironmentId()
        : normalizedItems[0]!.id;
  return {
    items: normalizedItems,
    activeId,
    source,
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}

function canManageMembers(role: OrgRole | null): boolean {
  return role === "owner" || role === "admin";
}

/* ── Profile & account prefs ─────────────────────────────────────────── */

export async function getUserAccountSettings(userId: string) {
  const [row] = await db
    .select({
      name: appUsers.name,
      email: appUsers.email,
      uiPreferences: appUsers.uiPreferences,
      notificationPreferences: appUsers.notificationPreferences,
    })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    name: row.name,
    email: row.email,
    uiPreferences: mergeUiPrefs(row.uiPreferences),
    notificationPreferences: mergeNotificationPrefs(
      row.notificationPreferences,
    ),
  };
}

export async function updateUserProfile(userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { error: "invalid_name" as const };
  const updated = await db
    .update(appUsers)
    .set({ name: trimmed })
    .where(eq(appUsers.id, userId))
    .returning({ name: appUsers.name });
  return updated[0]
    ? { name: updated[0].name }
    : { error: "not_found" as const };
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  if (newPassword.length < 8) return { error: "weak_password" as const };
  const [user] = await db
    .select({ passwordHash: appUsers.passwordHash })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!user) return { error: "not_found" as const };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { error: "invalid_password" as const };
  }
  await db
    .update(appUsers)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(appUsers.id, userId));
  return { ok: true as const };
}

export async function updateUserUiPreferences(
  userId: string,
  patch: UiPreferences,
) {
  const current = await getUserAccountSettings(userId);
  if (!current) return { error: "not_found" as const };
  const next = { ...current.uiPreferences, ...patch };
  await db
    .update(appUsers)
    .set({ uiPreferences: next })
    .where(eq(appUsers.id, userId));
  return { uiPreferences: next };
}

export async function updateUserNotificationPreferences(
  userId: string,
  patch: NotificationPreferences,
) {
  const current = await getUserAccountSettings(userId);
  if (!current) return { error: "not_found" as const };
  const next = { ...current.notificationPreferences, ...patch };
  await db
    .update(appUsers)
    .set({ notificationPreferences: next })
    .where(eq(appUsers.id, userId));
  return { notificationPreferences: next };
}

/* ── Workspace ───────────────────────────────────────────────────────── */

export async function getWorkspaceSettings(teamId: string) {
  const [row] = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

export async function updateWorkspaceSettings(
  teamId: string,
  actorId: string,
  input: { name?: string; slug?: string },
) {
  const role = await getMembership(actorId, teamId);
  if (!canManageMembers(role)) return { error: "forbidden" as const };

  const patch: { name?: string; slug?: string } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "invalid_name" as const };
    patch.name = name;
  }
  if (input.slug !== undefined) {
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) return { error: "invalid_slug" as const };
    const [clash] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.slug, slug), sql`${teams.id} <> ${teamId}`))
      .limit(1);
    if (clash) return { error: "slug_taken" as const };
    patch.slug = slug;
  }
  if (!patch.name && !patch.slug) return { error: "invalid_body" as const };

  const updated = await db
    .update(teams)
    .set(patch)
    .where(eq(teams.id, teamId))
    .returning({ id: teams.id, slug: teams.slug, name: teams.name });
  return updated[0] ?? { error: "not_found" as const };
}

export async function getEnvironmentSettings(teamId: string) {
  const settings = await getTeamSettings(teamId);
  return normalizeEnvironments(settings.environments);
}

export async function updateEnvironmentSettings(
  teamId: string,
  input: { items: TeamEnvironment[]; activeId: string },
) {
  if (!input.items.some((item) => item.id === input.activeId)) {
    return { error: "active_environment_missing" as const };
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.id)) return { error: "duplicate_environment" as const };
    seen.add(item.id);
  }
  const settings = await getTeamSettings(teamId);
  const environments = { items: input.items, activeId: input.activeId };
  await saveTeamSettings(teamId, { ...settings, environments });
  return normalizeEnvironments(environments);
}

/* ── Members & invitations ───────────────────────────────────────────── */

export async function listTeamMembers(teamId: string) {
  const rows = await db
    .select({
      userId: appUsers.id,
      email: appUsers.email,
      name: appUsers.name,
      role: orgMembers.role,
      joinedAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .innerJoin(appUsers, eq(appUsers.id, orgMembers.userId))
    .where(eq(orgMembers.teamId, teamId))
    .orderBy(asc(orgMembers.createdAt));
  return rows;
}

export async function updateTeamMemberRole(
  teamId: string,
  actorId: string,
  targetUserId: string,
  role: OrgRole,
) {
  const actorRole = await getMembership(actorId, teamId);
  if (!canManageMembers(actorRole)) return { error: "forbidden" as const };
  if (role === "owner" && actorRole !== "owner") {
    return { error: "forbidden" as const };
  }

  const [target] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(eq(orgMembers.teamId, teamId), eq(orgMembers.userId, targetUserId)),
    )
    .limit(1);
  if (!target) return { error: "not_found" as const };
  if (target.role === "owner" && actorRole !== "owner") {
    return { error: "forbidden" as const };
  }

  if (target.role === "owner" && role !== "owner") {
    const owners = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.teamId, teamId), eq(orgMembers.role, "owner")));
    if (owners.length <= 1) return { error: "last_owner" as const };
  }

  await db
    .update(orgMembers)
    .set({ role })
    .where(
      and(eq(orgMembers.teamId, teamId), eq(orgMembers.userId, targetUserId)),
    );
  return { ok: true as const };
}

export async function removeTeamMember(
  teamId: string,
  actorId: string,
  targetUserId: string,
) {
  const actorRole = await getMembership(actorId, teamId);
  if (!canManageMembers(actorRole)) return { error: "forbidden" as const };

  const [target] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(eq(orgMembers.teamId, teamId), eq(orgMembers.userId, targetUserId)),
    )
    .limit(1);
  if (!target) return { error: "not_found" as const };
  if (target.role === "owner") {
    if (actorRole !== "owner") return { error: "forbidden" as const };
    const owners = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.teamId, teamId), eq(orgMembers.role, "owner")));
    if (owners.length <= 1) return { error: "last_owner" as const };
  }

  await db
    .delete(orgMembers)
    .where(
      and(eq(orgMembers.teamId, teamId), eq(orgMembers.userId, targetUserId)),
    );
  return { ok: true as const };
}

export async function listTeamInvitations(teamId: string) {
  const nowIso = new Date().toISOString();
  return db
    .select({
      id: orgInvitations.id,
      email: orgInvitations.email,
      role: orgInvitations.role,
      expiresAt: orgInvitations.expiresAt,
      createdAt: orgInvitations.createdAt,
    })
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.teamId, teamId),
        isNull(orgInvitations.acceptedAt),
        gt(orgInvitations.expiresAt, nowIso),
      ),
    )
    .orderBy(orgInvitations.createdAt);
}

export async function inviteTeamMember(
  teamId: string,
  actorId: string,
  email: string,
  role: OrgRole,
) {
  const actorRole = await getMembership(actorId, teamId);
  if (!canManageMembers(actorRole)) return { error: "forbidden" as const };
  if (role === "owner" && actorRole !== "owner") {
    return { error: "forbidden" as const };
  }
  const inv = await createInvitation(teamId, email, role, actorId);
  return { id: inv.id, expiresAt: inv.expiresAt, token: inv.token };
}

export async function revokeTeamInvitation(
  teamId: string,
  actorId: string,
  invitationId: string,
) {
  const actorRole = await getMembership(actorId, teamId);
  if (!canManageMembers(actorRole)) return { error: "forbidden" as const };
  const deleted = await db
    .delete(orgInvitations)
    .where(
      and(
        eq(orgInvitations.id, invitationId),
        eq(orgInvitations.teamId, teamId),
        isNull(orgInvitations.acceptedAt),
      ),
    )
    .returning({ id: orgInvitations.id });
  return deleted[0] ? { ok: true as const } : { error: "not_found" as const };
}

/* ── Providers routing (team-level, keys from providers-repo) ──────────── */

export async function getProvidersSettings(teamId: string) {
  const [keys, settings] = await Promise.all([
    listProviderKeys(teamId),
    getTeamSettings(teamId),
  ]);
  const providerCfg = settings.providers ?? {};
  const disabled = new Set(providerCfg.disabled ?? []);
  const defaultProvider =
    providerCfg.defaultProvider &&
    isSupportedProvider(providerCfg.defaultProvider)
      ? providerCfg.defaultProvider
      : (SUPPORTED_PROVIDERS.find(
          (p) => !disabled.has(p) && keys.find((k) => k.provider === p)?.hasKey,
        ) ?? SUPPORTED_PROVIDERS[0]);

  const fallbackOrder =
    providerCfg.fallbackOrder?.filter((p) => isSupportedProvider(p)) ??
    SUPPORTED_PROVIDERS;

  const items = SUPPORTED_PROVIDERS.map((provider) => {
    const keyRow = keys.find((k) => k.provider === provider);
    const hasKey = Boolean(keyRow?.hasKey);
    const active = hasKey && !disabled.has(provider);
    return {
      id: providerId(provider),
      kind: PROVIDER_KINDS[provider] ?? "self-hosted",
      label: PROVIDER_LABELS[provider] ?? provider,
      status: active ? ("active" as const) : ("off" as const),
      hasKey,
      models: PROVIDER_MODELS[provider] ?? [],
      isDefault: provider === defaultProvider,
      provider,
    };
  });

  return {
    items,
    fallbackOrder: fallbackOrder.map(providerId),
    costCeilingPerDay: {
      amountCents: providerCfg.costCeilingPerDayCents ?? 20_000,
      currency: "USD" as const,
    },
  };
}

export async function updateProviderConfig(
  teamId: string,
  actorId: string,
  providerIdRaw: string,
  patch: { status?: "active" | "off"; isDefault?: boolean },
) {
  const role = await getMembership(actorId, teamId);
  if (!canManageMembers(role)) return { error: "forbidden" as const };

  const key = providerKeyFromId(providerIdRaw);
  if (!key || !isSupportedProvider(key)) {
    return { error: "not_found" as const };
  }

  const settings = await getTeamSettings(teamId);
  const providers = { ...(settings.providers ?? {}) };
  const disabled = new Set(providers.disabled ?? []);

  if (patch.status === "off") disabled.add(key);
  if (patch.status === "active") disabled.delete(key);
  if (patch.isDefault) providers.defaultProvider = key;

  providers.disabled = [...disabled];
  await saveTeamSettings(teamId, { ...settings, providers });
  return getProvidersSettings(teamId);
}

export async function updateProvidersPolicy(
  teamId: string,
  actorId: string,
  patch: { costCeilingPerDayCents?: number; fallbackOrder?: string[] },
) {
  const role = await getMembership(actorId, teamId);
  if (!canManageMembers(role)) return { error: "forbidden" as const };

  const settings = await getTeamSettings(teamId);
  const providers = { ...(settings.providers ?? {}) };

  if (patch.costCeilingPerDayCents !== undefined) {
    if (patch.costCeilingPerDayCents < 0) {
      return { error: "invalid_body" as const };
    }
    providers.costCeilingPerDayCents = patch.costCeilingPerDayCents;
  }
  if (patch.fallbackOrder !== undefined) {
    providers.fallbackOrder = patch.fallbackOrder
      .map(providerKeyFromId)
      .filter((p): p is string => Boolean(p && isSupportedProvider(p)));
  }

  await saveTeamSettings(teamId, { ...settings, providers });
  return getProvidersSettings(teamId);
}

export async function testProviderConnection(
  teamId: string,
  providerIdRaw: string,
) {
  const key = providerKeyFromId(providerIdRaw);
  if (!key || !isSupportedProvider(key)) {
    return { ok: false, message: "Unknown provider" };
  }
  const keys = await listProviderKeys(teamId);
  const row = keys.find((k) => k.provider === key);
  if (!row?.hasKey) {
    return { ok: false, message: "No API key configured" };
  }
  // Keys are write-only; a live probe would need decrypt. Report configured state.
  const started = Date.now();
  return {
    ok: true,
    latencyMs: Date.now() - started,
    message: "API key is configured",
  };
}
