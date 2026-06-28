import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { encryptJson, decryptJson } from "../../infra/crypto";
import { recordAudit } from "../../infra/audit";
import { exchangeCodexCode, refreshCodexToken } from "../../infra/oauth";

const { providerKeys, runtimeOauthTokens } = schema;

/**
 * Runtime provider keys, managed from the web UI and injected into the daemon at
 * claim time. Each provider maps to the env var its CLI/runtime expects, so the
 * key just appears in the runtime's environment (Hermes/claude read it natively).
 */
const PROVIDER_ENV: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_ENV);

export function isSupportedProvider(p: string): boolean {
  return p in PROVIDER_ENV;
}

/** List every supported provider with whether a key is configured (never the value). */
export async function listProviderKeys(teamId: string) {
  const rows = await db
    .select({ provider: providerKeys.provider, updatedAt: providerKeys.updatedAt })
    .from(providerKeys)
    .where(eq(providerKeys.teamId, teamId));
  const byProvider = new Map(rows.map((r) => [r.provider, r.updatedAt]));
  return SUPPORTED_PROVIDERS.map((provider) => ({
    provider,
    envVar: PROVIDER_ENV[provider],
    hasKey: byProvider.has(provider),
    updatedAt: byProvider.get(provider) ?? null,
  }));
}

/** Upsert an encrypted provider key for the org. */
export async function setProviderKey(teamId: string, provider: string, key: string): Promise<void> {
  if (!isSupportedProvider(provider)) throw new Error("unsupported_provider");
  const secret = encryptJson({ key });
  const [existing] = await db
    .select({ id: providerKeys.id })
    .from(providerKeys)
    .where(and(eq(providerKeys.teamId, teamId), eq(providerKeys.provider, provider)))
    .limit(1);
  if (existing) {
    await db.update(providerKeys).set({ secret, updatedAt: sql`now()` }).where(eq(providerKeys.id, existing.id));
  } else {
    await db.insert(providerKeys).values({ id: genId("pkey"), teamId, provider, secret });
  }
  // Audit the change — provider name only, NEVER the key material.
  await recordAudit({
    teamId,
    action: "provider_key.set",
    targetType: "provider_key",
    targetId: provider,
  });
}

export async function deleteProviderKey(teamId: string, provider: string): Promise<void> {
  await db.delete(providerKeys).where(and(eq(providerKeys.teamId, teamId), eq(providerKeys.provider, provider)));
  await recordAudit({
    teamId,
    action: "provider_key.delete",
    targetType: "provider_key",
    targetId: provider,
  });
}

/** Decrypt a single provider's key (or null if unset/corrupt). Used by the LLM router. */
export async function getDecryptedProviderKey(
  teamId: string,
  provider: string,
): Promise<string | null> {
  const [row] = await db
    .select({ secret: providerKeys.secret })
    .from(providerKeys)
    .where(and(eq(providerKeys.teamId, teamId), eq(providerKeys.provider, provider)))
    .limit(1);
  if (!row) return null;
  try {
    return decryptJson<{ key: string }>(row.secret).key;
  } catch {
    return null;
  }
}

/**
 * Decrypt all of an org's provider keys into { ENV_VAR: value } for runtime
 * injection at claim time. Corrupt blobs are skipped rather than failing the claim.
 */
export async function resolveProviderEnv(teamId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ provider: providerKeys.provider, secret: providerKeys.secret })
    .from(providerKeys)
    .where(eq(providerKeys.teamId, teamId));
  const env: Record<string, string> = {};
  for (const r of rows) {
    const envVar = PROVIDER_ENV[r.provider];
    if (!envVar) continue;
    try {
      env[envVar] = decryptJson<{ key: string }>(r.secret).key;
    } catch {
      /* skip a corrupt/unreadable blob */
    }
  }
  return env;
}

/* ── Codex (ChatGPT) subscription OAuth tokens ─────────────────────────── */

export type StoredCodexTokens = {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  account_id?: string;
  /** Epoch ms when the access token expires (refresh before this). */
  expiresAtMs?: number;
};

/** Refresh the access token this many ms before expiry (mirrors sinew's skew). */
const CODEX_REFRESH_SKEW_MS = 60_000;

export async function saveCodexOauth(teamId: string, tokens: StoredCodexTokens): Promise<void> {
  const secret = encryptJson(tokens);
  const [existing] = await db
    .select({ id: runtimeOauthTokens.id })
    .from(runtimeOauthTokens)
    .where(and(eq(runtimeOauthTokens.teamId, teamId), eq(runtimeOauthTokens.provider, "codex")))
    .limit(1);
  if (existing) {
    await db
      .update(runtimeOauthTokens)
      .set({ secret, updatedAt: sql`now()` })
      .where(eq(runtimeOauthTokens.id, existing.id));
  } else {
    await db
      .insert(runtimeOauthTokens)
      .values({ id: genId("roauth"), teamId, provider: "codex", secret });
  }
  await recordAudit({
    teamId,
    action: "runtime_oauth.set",
    targetType: "runtime_oauth",
    targetId: "codex",
  });
}

/** Exchange a captured authorization code (from the daemon loopback flow) and store the tokens. */
export async function connectCodexFromCode(opts: {
  teamId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ connected: true; accountId: string | null }> {
  const t = await exchangeCodexCode({
    code: opts.code,
    redirectUri: opts.redirectUri,
    codeVerifier: opts.codeVerifier,
  });
  await saveCodexOauth(opts.teamId, {
    access_token: t.accessToken,
    refresh_token: t.refreshToken,
    id_token: t.idToken,
    account_id: t.accountId,
    expiresAtMs: t.expiresInSec ? Date.now() + t.expiresInSec * 1_000 : undefined,
  });
  return { connected: true, accountId: t.accountId ?? null };
}

export async function getCodexOauth(teamId: string): Promise<StoredCodexTokens | null> {
  const [row] = await db
    .select({ secret: runtimeOauthTokens.secret })
    .from(runtimeOauthTokens)
    .where(and(eq(runtimeOauthTokens.teamId, teamId), eq(runtimeOauthTokens.provider, "codex")))
    .limit(1);
  if (!row) return null;
  try {
    return decryptJson<StoredCodexTokens>(row.secret);
  } catch {
    return null;
  }
}

export async function deleteCodexOauth(teamId: string): Promise<void> {
  await db
    .delete(runtimeOauthTokens)
    .where(and(eq(runtimeOauthTokens.teamId, teamId), eq(runtimeOauthTokens.provider, "codex")));
  await recordAudit({
    teamId,
    action: "runtime_oauth.delete",
    targetType: "runtime_oauth",
    targetId: "codex",
  });
}

/** Connection status (never the tokens) for the Settings UI. */
export async function getCodexOauthStatus(teamId: string) {
  const tokens = await getCodexOauth(teamId);
  return {
    connected: Boolean(tokens),
    accountId: tokens?.account_id ?? null,
    expiresAtMs: tokens?.expiresAtMs ?? null,
  };
}

/**
 * Like resolveProviderEnv, but also injects subscription OAuth. When the team has
 * connected Codex, the (refreshed) tokens are added as an AGENTIK_CODEX_AUTH JSON
 * blob that the daemon materializes into ~/.codex/auth.json. Refresh failures are
 * swallowed — we still inject the existing token (codex CLI may refresh in-process).
 */
export async function resolveRuntimeAuth(teamId: string): Promise<Record<string, string>> {
  const env = await resolveProviderEnv(teamId);
  let tokens = await getCodexOauth(teamId);
  if (!tokens) return env;

  const nearExpiry =
    tokens.expiresAtMs !== undefined &&
    Date.now() + CODEX_REFRESH_SKEW_MS >= tokens.expiresAtMs;
  if (nearExpiry && tokens.refresh_token) {
    try {
      const r = await refreshCodexToken(tokens.refresh_token);
      tokens = {
        access_token: r.accessToken,
        refresh_token: r.refreshToken || tokens.refresh_token,
        id_token: r.idToken ?? tokens.id_token,
        account_id: r.accountId ?? tokens.account_id,
        expiresAtMs: r.expiresInSec ? Date.now() + r.expiresInSec * 1_000 : undefined,
      };
      await saveCodexOauth(teamId, tokens);
    } catch {
      /* keep the existing token; codex CLI can still refresh from refresh_token */
    }
  }

  env.AGENTIK_CODEX_AUTH = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    account_id: tokens.account_id,
  });
  return env;
}
