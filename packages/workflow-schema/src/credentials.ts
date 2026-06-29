import { z } from "zod";

/**
 * Credential contract shared by web, the engine API and the executor. Secret
 * values live in `data` (a flat string map), encrypted at rest by the engine
 * and NEVER returned to clients — the summary deliberately omits `data`.
 */

export const CREDENTIAL_TYPES = ["httpHeaderAuth", "slackApi", "googleOAuth2"] as const;
export const credentialType = z.enum(CREDENTIAL_TYPES);
export type CredentialType = z.infer<typeof credentialType>;

/** Human-friendly labels for each credential type (UI display). */
export const CREDENTIAL_LABELS: Record<string, string> = {
  httpHeaderAuth: "Header auth",
  slackApi: "Slack",
  googleOAuth2: "Google OAuth2",
};

/** Credential types that require an OAuth2 connect step after creation. */
export const OAUTH_CREDENTIAL_TYPES = ["googleOAuth2"] as const;
export function isOAuthCredential(type: CredentialType): boolean {
  return (OAUTH_CREDENTIAL_TYPES as readonly string[]).includes(type);
}

/** Per-type secret/config field names, for the UI to render the right inputs. */
export const CREDENTIAL_FIELDS: Record<CredentialType, ReadonlyArray<{ key: string; label: string }>> = {
  httpHeaderAuth: [
    { key: "name", label: "Header name" },
    { key: "value", label: "Header value" },
  ],
  slackApi: [{ key: "token", label: "Bot token" }],
  // OAuth2: the user supplies their own Google OAuth app client id/secret (no engine
  // env needed) plus the scopes. Tokens are filled in after consent.
  googleOAuth2: [
    { key: "clientId", label: "Google client ID" },
    { key: "clientSecret", label: "Google client secret" },
    { key: "scope", label: "Scopes (space-separated)" },
  ],
};

/** Raw secret payload (validated loosely; the UI enforces per-type fields). */
export const credentialData = z.record(z.string(), z.string());
export type CredentialData = z.infer<typeof credentialData>;

export const createCredentialInput = z.object({
  type: credentialType,
  name: z.string().min(1),
  data: credentialData,
});
export type CreateCredentialInput = z.infer<typeof createCredentialInput>;

/** Safe projection returned by the API — no secret material. */
export const credentialSummary = z.object({
  id: z.string(),
  teamId: z.string(),
  type: credentialType,
  name: z.string(),
  /** For OAuth credentials: whether the consent flow has completed (token present). */
  connected: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CredentialSummary = z.infer<typeof credentialSummary>;
