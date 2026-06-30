/**
 * Reconnect Gmail via the Google OAuth2 authorization-code flow, end to end, using the
 * app's GOOGLE_CLIENT_ID/SECRET from the env. Two modes:
 *
 *   url            → print the Google consent URL (open it in a logged-in browser)
 *   store          → exchange the captured code (env CODE=...) for tokens and persist a
 *                    `googleOAuth2` credential for the team (replacing any existing one)
 *
 * The redirect target is the engine's registered callback (404s without a handler — that
 * is expected); we only need the `code` query param from the redirected URL.
 *
 * Usage:
 *   bun run scripts/connect-gmail-oauth.ts url
 *   CODE="<code-from-redirect>" bun run scripts/connect-gmail-oauth.ts store
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";
import { env } from "../src/infra/env";
import { buildGoogleAuthUrl, exchangeGoogleCode, googleRedirectUri } from "../src/infra/oauth";
import { createCredential, deleteCredential, listCredentials } from "../src/domains/credentials/repo";

const TEAM = process.env.TEAM ?? "demo";
const SCOPE =
  process.env.GMAIL_SCOPES ??
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
const CRED_NAME = process.env.GMAIL_CRED_NAME ?? "Gmail (kev.aubree@gmail.com)";

async function teamId(): Promise<string> {
  const [t] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, TEAM))
    .limit(1);
  if (!t) throw new Error(`team '${TEAM}' not found`);
  return t.id;
}

async function main() {
  const mode = process.argv[2];
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing in env");

  if (mode === "url") {
    const url = buildGoogleAuthUrl({ clientId, scope: SCOPE, state: "agentik-gmail" });
    console.log(`redirect_uri (must be registered): ${googleRedirectUri()}`);
    console.log(`\nCONSENT_URL:\n${url}`);
    process.exit(0);
  }

  if (mode === "store") {
    const code = process.env.CODE?.trim();
    if (!code) throw new Error("CODE env is required (the ?code=... from the redirect URL)");
    const tokens = await exchangeGoogleCode({ code, clientId, clientSecret });
    if (!tokens.refresh_token) {
      console.log("⚠ no refresh_token returned (re-consent with prompt=consent). Got access_token only.");
    }
    const tid = await teamId();
    // Replace any existing Google credential so there is exactly one.
    for (const c of await listCredentials(tid)) {
      if (c.type === "googleOAuth2") await deleteCredential(tid, c.id);
    }
    const cred = await createCredential(tid, {
      type: "googleOAuth2",
      name: CRED_NAME,
      data: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? "",
        expires_at: String(Date.now() + (tokens.expires_in ?? 3600) * 1000),
        scope: tokens.scope ?? SCOPE,
      },
    });
    console.log(`✅ Gmail credential stored: ${cred.id} (team=${TEAM})`);
    console.log(`   scopes: ${tokens.scope ?? SCOPE}`);
    console.log(`   refresh_token: ${tokens.refresh_token ? "present (offline access OK)" : "ABSENT"}`);
    process.exit(0);
  }

  throw new Error(`unknown mode '${mode}' — use 'url' or 'store'`);
}

main().catch((e) => {
  console.error("connect-gmail-oauth failed:", (e as Error).message);
  process.exit(1);
});
