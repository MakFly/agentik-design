import { eq, sql } from "drizzle-orm";
import { generateText, stepCountIs } from "ai";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";
import {
  deliverEmail,
  listGmailMessages,
  type GmailMessageSummary,
} from "../../infra/gmail";
import { onRunCompleted } from "../runs/service";
import { resolveProviderEnv } from "../settings/providers-repo";
import {
  resolveApiProvider,
  buildModel,
  naturalProviderForKind,
  type ApiProvider,
} from "../../execution/embedded/runtime/api";
import { resolveInjectionContext, buildInjectionPreamble } from "../learning";
import { buildGmailTools, type GmailCapabilities } from "./gmail-tools";
import { buildWebTools } from "./web-tools";
import { buildAgentTools } from "./agent-tools";

const { runs, runMessages } = schema;

/** Skill ids an agent can declare in its config to get deterministic, engine-side fulfilment. */
export const GMAIL_READ_SKILL = "gmail.read";
export const GMAIL_SEND_SKILL = "gmail.send";

export function agentSkills(config: unknown): string[] {
  const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  return Array.isArray(c.skills)
    ? (c.skills as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
}

function agentTools(config: unknown): Array<Record<string, unknown>> {
  const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  return Array.isArray(c.tools)
    ? (c.tools as unknown[]).filter(
        (tool): tool is Record<string, unknown> =>
          Boolean(tool && typeof tool === "object"),
      )
    : [];
}

function hasEmailSendCapability(config: unknown): boolean {
  return (
    agentSkills(config).includes(GMAIL_SEND_SKILL) ||
    agentTools(config).some((tool) => tool.toolId === GMAIL_SEND_SKILL)
  );
}

/**
 * True when the agent declares any deterministic engine-side builtin skill. Such turns
 * must go through the queue path (the engine fulfils them server-side), so the in-process
 * chat gateway defers them rather than running a plain LLM turn that would bypass the skill.
 */
export function agentHasBuiltinSkill(config: unknown): boolean {
  const skills = agentSkills(config);
  const tools = agentTools(config);
  const builtins = [GMAIL_READ_SKILL, GMAIL_SEND_SKILL];
  return (
    builtins.some((id) => skills.includes(id)) ||
    tools.some((tool) => builtins.includes(tool.toolId as string))
  );
}

// Deliberately narrow: real email nouns only. "message(s)" is too broad (it would route
// generic turns like "traduis ton dernier message" to the non-streamed builtin path).
const INBOX_RE = /\b(e-?mails?|inbox|courriels?|mails?|bo[iî]te)\b/i;
const INBOX_READ_RE =
  /\b(lis|lire|lecture|lu|affiche|montre|donne|liste|r[ée]cup[èe]re|check|read|show|list|get|last|latest|dernier(?:s|es)?|nouveaux?)\b/i;
const EMAIL_SEND_RE = /\b(envoie|envoyer|envoies|send|mail|e-?mail|courriel)\b/i;
const EMAIL_ADDRESS_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const DEFAULT_MAIL_FROM =
  process.env.MAIL_FROM ?? process.env.SEED_OPERATOR_EMAIL ?? "assistant@agentik.dev";

function looksLikeEmailSend(text: string): boolean {
  return EMAIL_SEND_RE.test(text) && EMAIL_ADDRESS_RE.test(text);
}

/**
 * Singular "the last/latest email" (no plural marker on the qualifier or the noun) →
 * the user wants a single message, not the default 5. Matches "le dernier email",
 * "donne le dernier mail", "the latest email"; NOT "les 5 derniers emails".
 */
const SINGLE_EMAIL_RE =
  /\b(dernier|premier|last|latest|newest|nouveau|nouvel)\b(?!s)[^.!?]*?\b(e-?mail|mail|courriel|message)\b(?!s)/i;

/** Resolve the requested count: explicit digit wins, else singular → 1, else default 5. */
function inboxReadCount(text: string): number {
  const digit = text.match(/\b(\d{1,2})\b/);
  if (digit) {
    const n = Number(digit[1]);
    if (Number.isFinite(n) && n >= 1) return Math.min(n, 15);
  }
  if (SINGLE_EMAIL_RE.test(text)) return 1;
  return 5;
}

/** Detect a "read my inbox" intent and the requested count (default 5, singular → 1, capped 15). */
export function matchInboxRead(text: string): { match: boolean; count: number } {
  const match = !looksLikeEmailSend(text) && INBOX_RE.test(text) && INBOX_READ_RE.test(text);
  return { match, count: inboxReadCount(text) };
}

export type EmailSendIntent =
  | {
      match: true;
      complete: true;
      to: string;
      subject: string;
      text: string;
    }
  | {
      match: true;
      complete: false;
      to?: string;
      subject?: string;
      text?: string;
      missing: Array<"recipient" | "subject" | "body">;
    }
  | { match: false };

function cleanField(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function captureLabeledField(
  text: string,
  labels: string[],
  stopLabels: string[],
): string | undefined {
  const label = labels.join("|");
  const stop = stopLabels.join("|");
  const connector = String.raw`(?:\s*(?:[,;]|\&|\+|\bet\b|\band\b|\bavec\b|\bwith\b)\s*)?`;
  const article = String.raw`(?:(?:le|la)\s+|l['’])?`;
  const re = new RegExp(
    `(?:^|[\\s,;])(?:${article})(?:${label})\\s*[:=\\-]?\\s*(?:"([^"]+)"|'([^']+)'|([\\s\\S]*?))(?=${connector}${article}(?:${stop})\\s*[:=\\-]?|$)`,
    "i",
  );
  const match = text.match(re);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  const cleaned = value ? cleanField(value) : "";
  return cleaned || undefined;
}

/** Detect a strict "send email" intent. Recipient, subject and body must be explicit. */
export function matchEmailSend(text: string): EmailSendIntent {
  if (!looksLikeEmailSend(text)) return { match: false };
  const to = text.match(EMAIL_ADDRESS_RE)?.[0]?.toLowerCase();
  const subject = captureLabeledField(
    text,
    ["sujet", "objet", "subject"],
    ["message", "body", "corps", "contenu", "texte"],
  );
  const body = captureLabeledField(
    text,
    ["message", "body", "corps", "contenu", "texte"],
    ["sujet", "objet", "subject"],
  );
  const missing: Array<"recipient" | "subject" | "body"> = [];
  if (!to) missing.push("recipient");
  if (!subject) missing.push("subject");
  if (!body) missing.push("body");
  if (missing.length) {
    return {
      match: true,
      complete: false,
      to,
      subject,
      text: body,
      missing,
    };
  }
  return { match: true, complete: true, to: to!, subject: subject!, text: body! };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Decode HTML entities, strip Gmail/LinkedIn invisible padding, and remove the few
 * Markdown-significant chars (the Telegram notifier renders the reply as Markdown,
 * so a stray `*`/backtick in a subject would break formatting).
 */
function clean(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENTITIES[n] ?? _)
    .replace(/[­​-‍͏⁠﻿]/g, "") // soft hyphen, zero-width, CGJ, word joiner, BOM
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Display Name" from a raw From header; falls back to the address local-part. */
function parseSender(from: string): string {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const email = m[2] ?? "";
    return clean(m[1] ?? "") || email.split("@")[0] || email;
  }
  const bare = from.trim();
  return clean(bare) || "(expéditeur inconnu)";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Human date: "aujourd'hui 10:30" / "hier 16:24" / "27-06-2026" (dd-mm-yyyy rule). */
function humanDate(value: string): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const d = new Date(t);
  const now = new Date();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `aujourd'hui ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `hier ${time}`;
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** One-line preview: clean + cut at a word boundary with an ellipsis (Gmail snippets are ~200c). */
function preview(snippet: string, max = 120): string {
  const text = clean(snippet);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function formatEmails(emails: GmailMessageSummary[]): string {
  if (!emails.length) return "📭 Ta boîte de réception est vide (ou aucun message ne correspond).";
  const header = emails.length === 1 ? "Dernier email" : `${emails.length} derniers emails`;
  const lines = [`📬 **${header}**`, ""];
  emails.forEach((m, i) => {
    const p = preview(m.snippet);
    lines.push(`**${i + 1}. ${clean(m.subject) || "(sans objet)"}**`);
    lines.push(`${parseSender(m.from)} · ${humanDate(m.date)}`);
    if (p) lines.push(p);
    lines.push("");
  });
  return lines.join("\n").trim();
}

/** Run the Gmail-read skill, mapping infra errors to actionable user-facing text. */
async function runGmailRead(
  teamId: string,
  count: number,
): Promise<{ text: string; emails?: Array<GmailMessageSummary & { fromName: string }> }> {
  try {
    const emails = await listGmailMessages(teamId, { maxResults: count });
    return {
      text: formatEmails(emails),
      emails: emails.map((email) => ({ ...email, fromName: parseSender(email.from) })),
    };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("gmail_not_connected"))
      return {
        text: "⚠️ Aucun compte Gmail connecté pour cette équipe — connecte-le dans Settings → Connections.",
      };
    if (msg.startsWith("gmail_api_disabled"))
      return {
        text: "⚠️ L'API Gmail n'est pas activée dans ton projet Google Cloud. Active-la, attends ~1 min, puis réessaie.",
      };
    if (msg.startsWith("gmail_scope_missing"))
      return {
        text: "⚠️ Le scope gmail.readonly manque sur la connexion. Reconnecte Gmail avec ce scope.",
      };
    return { text: `⚠️ Lecture Gmail impossible : ${msg}` };
  }
}

function missingEmailSendReply(intent: Extract<EmailSendIntent, { complete: false }>): string {
  const labels: Record<(typeof intent.missing)[number], string> = {
    recipient: "destinataire",
    subject: "sujet",
    body: "message",
  };
  return [
    `⚠️ Il manque : ${intent.missing.map((item) => labels[item]).join(", ")}.`,
    "",
    "Exemple :",
    'Envoie un email à operator@example.test avec le sujet "Test" et le message "Hello depuis Telegram."',
  ].join("\n");
}

/** Run the Gmail-send skill. Falls back to Mailpit exactly like the existing infra path. */
async function runGmailSend(
  teamId: string,
  intent: Extract<EmailSendIntent, { complete: true }>,
): Promise<{
  text: string;
  email: { to: string; subject: string; transport?: "gmail" | "mailpit"; delivered: boolean };
}> {
  try {
    const { transport } = await deliverEmail(teamId, {
      from: DEFAULT_MAIL_FROM,
      to: intent.to,
      subject: intent.subject.replace(/[\r\n]+/g, " ").trim(),
      text: intent.text,
    });
    return {
      text: [
        `✅ Email envoyé à ${intent.to}`,
        `Sujet : ${intent.subject}`,
        `Transport : ${transport}`,
      ].join("\n"),
      email: { to: intent.to, subject: intent.subject, transport, delivered: true },
    };
  } catch (e) {
    const msg = (e as Error).message;
    if (/gmail send failed:\s*(401|403)/i.test(msg))
      return {
        text: "⚠️ Envoi Gmail impossible : le scope gmail.send manque ou la connexion Google a expiré. Reconnecte Gmail dans Settings → Connections.",
        email: { to: intent.to, subject: intent.subject, delivered: false },
      };
    return {
      text: `⚠️ Envoi email impossible : ${msg}`,
      email: { to: intent.to, subject: intent.subject, delivered: false },
    };
  }
}

export interface BuiltinSkillContext {
  teamId: string;
  sessionId: string;
  agentId: string;
  config: unknown;
  /** Agent runtime kind — picks the natural provider for in-process tool-calling. */
  runtimeKind?: string;
  content: string;
  prompt: string;
  parentRunId?: string | null;
  inputMeta?: Record<string, unknown>;
}

async function finishBuiltinRun(
  ctx: BuiltinSkillContext,
  skill: string,
  text: string,
  extraInput: Record<string, unknown> = {},
  extraResult: Record<string, unknown> = {},
): Promise<{ taskId: string; completed: true }> {
  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId: ctx.teamId,
    executor: "daemon",
    agentId: ctx.agentId,
    status: "running",
    kind: "chat",
    chatSessionId: ctx.sessionId,
    parentRunId: ctx.parentRunId ?? null,
    input: {
      prompt: ctx.prompt,
      rawPrompt: ctx.content,
      skill,
      ...extraInput,
      ...(ctx.inputMeta ?? {}),
    },
    stepCount: 1,
    completedSteps: 0,
    startedAt: sql`now()`,
  });
  hub.publish(ctx.teamId, { kind: "run", action: "created", runId });

  const result = { ok: true, result: text, skill, ...extraResult };

  await db.insert(runMessages).values({
    id: genId("amsg"),
    runId,
    seq: 1,
    type: "text",
    tool: skill,
    content: text,
  });
  await db
    .update(runs)
    .set({
      status: "succeeded",
      result,
      completedSteps: 1,
      endedAt: sql`now()`,
      durationMs: sql`(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int`,
    })
    .where(eq(runs.id, runId));

  await onRunCompleted(ctx.teamId, runId, result, {
    chatSessionId: ctx.sessionId,
    projectTaskId: null,
  }).catch(() => undefined);

  return { taskId: runId, completed: true };
}

/** The Gmail capabilities an agent declares (read via skill, send via skill or tool grant). */
function gmailCapabilities(config: unknown): GmailCapabilities {
  return {
    read: agentSkills(config).includes(GMAIL_READ_SKILL),
    send: hasEmailSendCapability(config),
  };
}

/**
 * Server-side fulfilment for Gmail-capable agents. Preferred path (OpenClaw model):
 * run the turn IN-PROCESS with the LLM and Gmail exposed as real, parameterised tools —
 * the model itself decides `maxResults`/`query`/recipient from natural language (no regex).
 * When no provider key is available it degrades to the deterministic intent matcher.
 *
 * The run is created already finished (the daemon's claim query needs `queued`, so it never
 * picks it up) and finalised through the SAME pipeline the daemon uses (`onRunCompleted` →
 * assistant turn + Telegram notify). Returns the run id when handled, or null to fall
 * through to the normal agent path (non-Gmail agents).
 */
export async function tryBuiltinSkill(
  ctx: BuiltinSkillContext,
): Promise<{ taskId: string; completed: true } | null> {
  const caps = gmailCapabilities(ctx.config);
  if (!caps.read && !caps.send) return null;

  // Lightweight routing gate (NOT business logic): only email-related turns are fulfilled
  // server-side. Everything else flows through the normal agent/daemon path so we don't
  // hijack unrelated turns (and keep run control/approvals intact). The "how many / which
  // emails" decision is left entirely to the LLM tool call below.
  const emailRelated =
    (caps.read && INBOX_RE.test(ctx.content)) ||
    (caps.send && EMAIL_SEND_RE.test(ctx.content));
  if (!emailRelated) return null;

  // Preferred: real LLM tool-calling. Needs a usable provider key for this team.
  const env = await resolveProviderEnv(ctx.teamId);
  const provider = resolveApiProvider(ctx.runtimeKind ?? "", env);
  const apiKey = provider ? env[provider.envVar] : undefined;
  if (provider && apiKey) {
    return fulfillGmailWithTools(ctx, caps, provider, apiKey);
  }

  // Fallback: deterministic intent matching (no provider key).
  return tryDeterministicGmail(ctx, caps);
}

/** OpenClaw-style fulfilment: LLM + Gmail tools, run entirely in this process. */
async function fulfillGmailWithTools(
  ctx: BuiltinSkillContext,
  caps: GmailCapabilities,
  provider: ApiProvider,
  apiKey: string,
): Promise<{ taskId: string; completed: true }> {
  const inj = await resolveInjectionContext(ctx.teamId, ctx.agentId);
  // Respect the agent's configured model (like the streaming gateway) — but only when the
  // resolved provider IS the agent's natural provider. If we had to borrow another provider's
  // key, the stored model id is cross-provider, so fall back to that provider's default.
  const agentProvider = naturalProviderForKind(ctx.runtimeKind ?? "");
  const modelId =
    agentProvider && provider.provider === agentProvider
      ? (inj.model ?? provider.defaultModel)
      : provider.defaultModel;
  const system = [
    inj.systemPrompt,
    "Tu peux lire et envoyer les emails Gmail de l'utilisateur via des outils. " +
      "Pour « le dernier / le plus récent email », appelle gmail_read avec maxResults=1. " +
      "Présente une liste d'emails de façon concise (numéro, sujet, expéditeur, date), " +
      "dans la langue de l'utilisateur. N'envoie un email que si destinataire, sujet et " +
      "corps sont explicites.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = buildInjectionPreamble(inj) + ctx.prompt;

  let text: string;
  try {
    const result = await generateText({
      model: buildModel(provider, modelId, apiKey),
      system,
      prompt,
      tools: { ...buildGmailTools(ctx.teamId, caps), ...buildWebTools(), ...buildAgentTools(ctx.teamId) },
      stopWhen: stepCountIs(6),
    });
    text = result.text?.trim() || "(réponse vide)";
  } catch (e) {
    text = `⚠️ ${(e as Error).message}`;
  }
  return finishBuiltinRun(ctx, "gmail.agent", text, { tooling: "llm" });
}

/** Deterministic fallback (regex intent matching) when no LLM provider key is available. */
async function tryDeterministicGmail(
  ctx: BuiltinSkillContext,
  caps: GmailCapabilities,
): Promise<{ taskId: string; completed: true } | null> {
  if (caps.send) {
    const sendIntent = matchEmailSend(ctx.content);
    if (sendIntent.match) {
      const outcome = sendIntent.complete
        ? await runGmailSend(ctx.teamId, sendIntent)
        : {
            text: missingEmailSendReply(sendIntent),
            email: {
              to: sendIntent.to ?? null,
              subject: sendIntent.subject ?? null,
              delivered: false,
            },
          };
      return finishBuiltinRun(
        ctx,
        GMAIL_SEND_SKILL,
        outcome.text,
        {
          email: {
            to: sendIntent.to ?? null,
            subject: sendIntent.subject ?? null,
            complete: sendIntent.complete,
          },
        },
        { email: outcome.email },
      );
    }
  }

  if (caps.read) {
    const readIntent = matchInboxRead(ctx.content);
    if (readIntent.match) {
      const outcome = await runGmailRead(ctx.teamId, readIntent.count);
      return finishBuiltinRun(
        ctx,
        GMAIL_READ_SKILL,
        outcome.text,
        { count: readIntent.count },
        { emails: outcome.emails ?? [] },
      );
    }
  }

  return null;
}
