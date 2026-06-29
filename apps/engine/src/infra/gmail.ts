/**
 * Real Gmail delivery via the Gmail API, gated behind GMAIL_LIVE. When off (default,
 * dev) or when no connected Google credential exists, email falls back to the local
 * SMTP relay (infra-mailpit). This is the "Gmail behind" path: connect a googleOAuth2
 * credential with gmail.send scope, set GMAIL_LIVE=true, and the same agent run that
 * sends to Mailpit in dev sends through the real inbox in production.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { decryptJson, encryptJson } from "./crypto";
import { env } from "./env";
import { refreshGoogleToken } from "./oauth";
import { sendMail, type OutboundMail } from "./mailer";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

function toRfc822(mail: OutboundMail): string {
  return [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    mail.text,
  ].join("\r\n");
}

/** Resolve a fresh Gmail access token for the team's connected Google credential. */
export async function resolveGmailAccessToken(teamId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.credentials)
    .where(and(eq(schema.credentials.teamId, teamId), eq(schema.credentials.type, "googleOAuth2")))
    .limit(1);
  if (!row) return null;

  let data: Record<string, string>;
  try {
    data = decryptJson<Record<string, string>>(row.data);
  } catch {
    return null;
  }
  if (!data.access_token && !data.refresh_token) return null;

  const expired = Number(data.expires_at ?? 0) < Date.now() + 60_000;
  if (expired && data.refresh_token) {
    const refreshed = await refreshGoogleToken({
      refreshToken: data.refresh_token,
      clientId: data.clientId || env.GOOGLE_CLIENT_ID || "",
      clientSecret: data.clientSecret || env.GOOGLE_CLIENT_SECRET || "",
    });
    data = {
      ...data,
      access_token: refreshed.access_token,
      expires_at: String(Date.now() + refreshed.expires_in * 1000),
    };
    await db
      .update(schema.credentials)
      .set({ data: encryptJson(data), updatedAt: sql`now()` })
      .where(eq(schema.credentials.id, row.id));
  }
  return data.access_token ?? null;
}

async function sendViaGmailApi(accessToken: string, mail: OutboundMail): Promise<void> {
  const raw = Buffer.from(toRfc822(mail)).toString("base64url");
  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    throw new Error(`gmail send failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

/**
 * Deliver an email through the configured transport: real Gmail when GMAIL_LIVE is on
 * and a connected Google credential is available, otherwise the local Mailpit relay.
 */
export async function deliverEmail(
  teamId: string,
  mail: OutboundMail,
): Promise<{ transport: "gmail" | "mailpit" }> {
  if (env.GMAIL_LIVE) {
    const token = await resolveGmailAccessToken(teamId);
    if (token) {
      await sendViaGmailApi(token, mail);
      return { transport: "gmail" };
    }
  }
  await sendMail(mail);
  return { transport: "mailpit" };
}
