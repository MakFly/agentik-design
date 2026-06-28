import { createHash, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Google OAuth2 (authorization-code flow). The per-app client id/secret live in
 * the credential; this module builds the consent URL and exchanges/refreshes
 * tokens. `access_type=offline` + `prompt=consent` ensure a refresh token.
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export function googleRedirectUri(): string {
  return `${env.ENGINE_PUBLIC_URL}/api/v1/oauth/google/callback`;
}

export function buildGoogleAuthUrl(opts: { clientId: string; scope: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: opts.scope || "https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as GoogleTokens & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(`Google token error: ${data.error_description ?? data.error ?? res.status}`);
  return data;
}

export function exchangeGoogleCode(opts: { code: string; clientId: string; clientSecret: string }) {
  return tokenRequest(
    new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  );
}

export function refreshGoogleToken(opts: { refreshToken: string; clientId: string; clientSecret: string }) {
  return tokenRequest(
    new URLSearchParams({
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: "refresh_token",
    }),
  );
}

/* ── Codex (ChatGPT) OAuth — subscription auth, ported from sinew ─────────
 *
 * Lets a user drive the `codex` CLI from their ChatGPT Plus/Pro subscription
 * instead of a metered API key. The client id is the public Codex CLI client,
 * so its allowed redirect_uri is loopback ONLY (http://localhost:1455/...). The
 * loopback flow therefore runs on a machine with a browser (the daemon `login`
 * subcommand); the engine just exchanges the captured code and stores tokens.
 *
 * ⚠️ Reuses Codex CLI's OAuth client id. Using a ChatGPT subscription for server
 * automation is a CGU grey area — opt-in only; the account may be flagged.
 */
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";

export interface PkceCodes {
  codeVerifier: string;
  codeChallenge: string;
}

export interface CodexTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  /** Seconds until the access token expires, when the provider reports it. */
  expiresInSec?: number;
}

/** PKCE S256 pair (RFC 7636). The verifier stays client/engine-side; only the challenge is sent. */
export function generatePkce(): PkceCodes {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** Random URL-safe value for the OAuth `state` parameter. */
export function generateOauthState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildCodexAuthorizeUrl(opts: {
  redirectUri: string;
  pkce: PkceCodes;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CODEX_CLIENT_ID,
    redirect_uri: opts.redirectUri,
    scope: CODEX_SCOPE,
    code_challenge: opts.pkce.codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: opts.state,
    originator: "agentik",
  });
  return `${CODEX_AUTHORIZE_URL}?${params.toString()}`;
}

/** Decode a JWT payload (no signature check) to read the ChatGPT account id. */
function chatgptAccountId(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  const part = idToken.split(".")[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const auth = payload["https://api.openai.com/auth"] as
      | Record<string, unknown>
      | undefined;
    const id =
      (auth?.["chatgpt_account_id"] as string | undefined) ??
      (payload["chatgpt_account_id"] as string | undefined) ??
      (payload["account_id"] as string | undefined);
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

async function codexTokenRequest(body: URLSearchParams): Promise<CodexTokens> {
  const res = await fetch(CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Codex token error: ${data.error_description ?? data.error ?? res.status}`,
    );
  }
  return {
    accessToken: data.access_token,
    // A refresh response may omit refresh_token → caller keeps the previous one.
    refreshToken: data.refresh_token ?? "",
    idToken: data.id_token,
    accountId: chatgptAccountId(data.id_token),
    expiresInSec: data.expires_in,
  };
}

export function exchangeCodexCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<CodexTokens> {
  return codexTokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: CODEX_CLIENT_ID,
      code_verifier: opts.codeVerifier,
    }),
  );
}

export function refreshCodexToken(refreshToken: string): Promise<CodexTokens> {
  return codexTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  );
}
