import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { encryptJson, decryptJson } from "./crypto";

const { providerKeys } = schema;

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
}

export async function deleteProviderKey(teamId: string, provider: string): Promise<void> {
  await db.delete(providerKeys).where(and(eq(providerKeys.teamId, teamId), eq(providerKeys.provider, provider)));
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
