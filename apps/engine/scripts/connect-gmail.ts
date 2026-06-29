/**
 * One-shot helper to connect a Gmail account via OAuth (replaces the manual curl in
 * docs/gmail-oauth-setup.md). Idempotent: reuses an existing Gmail credential by name.
 *
 *   1. find-or-create a googleOAuth2 credential with the gmail.send scope
 *   2. print the authorize URL to open in the browser (while logged into the app)
 *
 * Usage:  bun --cwd apps/engine connect:gmail
 * Env:    ENGINE_URL (default http://localhost:8787), TEAM (default demo),
 *         GMAIL_SCOPES (default: gmail.send + gmail.readonly)
 */
const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8787";
const TEAM = process.env.TEAM ?? "demo";
const NAME = process.env.GMAIL_CRED_NAME ?? "Gmail (kev.aubree@gmail.com)";
const SCOPES =
  process.env.GMAIL_SCOPES ??
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";

const headers = { "content-type": "application/json", "x-team": TEAM, "x-role": "owner" };

interface CredentialSummary {
  id: string;
  type: string;
  name: string;
  connected: boolean;
}

async function listCredentials(): Promise<CredentialSummary[]> {
  const res = await fetch(`${ENGINE}/api/v1/credentials`, { headers });
  if (!res.ok) throw new Error(`list credentials failed: ${res.status} (is the engine up?)`);
  const body = (await res.json()) as CredentialSummary[] | { items: CredentialSummary[] };
  return Array.isArray(body) ? body : (body.items ?? []);
}

async function main() {
  const existing = (await listCredentials()).find(
    (c) => c.type === "googleOAuth2" && c.name === NAME,
  );

  let cred = existing;
  if (cred) {
    console.log(`Reusing existing credential ${cred.id} (connected: ${cred.connected})`);
  } else {
    const res = await fetch(`${ENGINE}/api/v1/credentials`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "googleOAuth2", name: NAME, data: { scope: SCOPES } }),
    });
    if (!res.ok) throw new Error(`create credential failed: ${res.status} ${await res.text()}`);
    cred = (await res.json()) as CredentialSummary;
    console.log(`Created credential ${cred.id}`);
  }

  const authorizeUrl = `${ENGINE}/api/v1/credentials/${cred.id}/authorize`;
  console.log("\nNext step — open this URL in a browser where you are logged into the app:\n");
  console.log(`  ${authorizeUrl}\n`);
  console.log("Then pick the Gmail account on the Google consent screen.");
  console.log("After consent, set GMAIL_LIVE=true in apps/engine/.env and restart the engine.");
  if (cred.connected) console.log("\n(Already connected — re-authorize only to change scopes/account.)");
}

main().catch((err) => {
  console.error("connect-gmail failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
