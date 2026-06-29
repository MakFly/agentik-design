/**
 * Real Gmail delivery via the Gmail API — NO env flag. When the team has a connected
 * googleOAuth2 credential (connected in Settings → Connections) email goes through
 * Gmail; otherwise it falls back to the local SMTP relay (infra-mailpit). Same agent
 * run, real inbox once connected.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { decryptJson, encryptJson } from "./crypto";
import { env } from "./env";
import { refreshGoogleToken } from "./oauth";
import { buildMailMessage, sendMail, type OutboundMail } from "./mailer";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * List the latest inbox messages for the team's connected Gmail account.
 * Reuses `resolveGmailAccessToken` (handles refresh). Requires the credential to
 * carry the `gmail.readonly` scope — otherwise Gmail returns 403 and we surface
 * a clear, actionable error instead of failing silently.
 */
export async function listGmailMessages(
  teamId: string,
  opts: { maxResults?: number } = {},
): Promise<GmailMessageSummary[]> {
  const token = await resolveGmailAccessToken(teamId);
  if (!token) throw new Error("gmail_not_connected: no Google credential for this team");
  const max = Math.min(Math.max(opts.maxResults ?? 5, 1), 25);

  const listRes = await fetch(`${GMAIL_API}/messages?maxResults=${max}&labelIds=INBOX`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => "");
    if (listRes.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(body)) {
      throw new Error(`gmail_api_disabled: enable the Gmail API in your Google Cloud project, then retry. (${body.slice(0, 160)})`);
    }
    if (listRes.status === 403 || listRes.status === 401) {
      throw new Error(`gmail_scope_missing: reading needs the gmail.readonly scope — reconnect Gmail with it. (${body.slice(0, 160)})`);
    }
    throw new Error(`gmail_list_failed: ${listRes.status} ${body.slice(0, 160)}`);
  }
  const { messages = [] } = (await listRes.json()) as { messages?: Array<{ id: string }> };

  const out: GmailMessageSummary[] = [];
  for (const { id } of messages) {
    const msgRes = await fetch(
      `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as {
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    const headers = msg.payload?.headers ?? [];
    out.push({
      id,
      from: header(headers, "From"),
      subject: header(headers, "Subject"),
      date: header(headers, "Date"),
      snippet: msg.snippet ?? "",
    });
  }
  return out;
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
  const raw = Buffer.from(buildMailMessage(mail)).toString("base64url");
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
 * Deliver an email through the best available transport, with NO env flag: if the team
 * has a CONNECTED Google credential (gmail.send, connected in Settings → Connections),
 * send through the real Gmail API; otherwise fall back to the local Mailpit relay. So
 * connecting Gmail in the UI is all it takes to go live; dev stays on Mailpit.
 */
export async function deliverEmail(
  teamId: string,
  mail: OutboundMail,
): Promise<{ transport: "gmail" | "mailpit" }> {
  const token = await resolveGmailAccessToken(teamId);
  if (token) {
    await sendViaGmailApi(token, mail);
    return { transport: "gmail" };
  }
  await sendMail(mail);
  return { transport: "mailpit" };
}
