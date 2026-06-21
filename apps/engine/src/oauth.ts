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
