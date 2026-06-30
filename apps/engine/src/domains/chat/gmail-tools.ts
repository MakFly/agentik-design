import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { listGmailMessages, deliverEmail, type GmailMessageSummary } from "../../infra/gmail";

/**
 * Gmail as real, parameterised LLM tools (OpenClaw model): the model decides the call
 * shape from natural language — `maxResults=1` for "the last email", a Gmail `query` for
 * "unread from LinkedIn" — instead of a hardcoded regex guessing a count. Each tool's
 * `execute` returns structured data and never throws: infra errors come back as an
 * `{ error }` payload so the model can relay an actionable message to the user.
 */

const DEFAULT_MAIL_FROM =
  process.env.MAIL_FROM ?? process.env.SEED_OPERATOR_EMAIL ?? "assistant@agentik.dev";

export interface GmailCapabilities {
  read: boolean;
  send: boolean;
}

function gmailError(e: unknown): { error: string } {
  const msg = (e as Error).message ?? String(e);
  if (msg.startsWith("gmail_not_connected"))
    return { error: "Aucun compte Gmail connecté pour cette équipe (Settings → Connections)." };
  if (msg.startsWith("gmail_api_disabled"))
    return { error: "L'API Gmail n'est pas activée dans le projet Google Cloud." };
  if (msg.startsWith("gmail_scope_missing") || /\b40[13]\b/.test(msg))
    return { error: "Le scope Gmail manque ou la connexion a expiré — reconnecte Gmail." };
  return { error: `Opération Gmail impossible : ${msg}` };
}

function compact(m: GmailMessageSummary) {
  return { from: m.from, subject: m.subject, date: m.date, snippet: m.snippet };
}

/** Build the Gmail tool set an agent is allowed to use, based on its declared capabilities. */
export function buildGmailTools(teamId: string, caps: GmailCapabilities): ToolSet {
  const tools: ToolSet = {};

  if (caps.read) {
    tools.gmail_read = tool({
      description:
        "Lire les emails récents de la boîte Gmail de l'utilisateur. " +
        "Utilise maxResults=1 pour « le dernier / le plus récent email », un nombre plus " +
        "grand quand plusieurs sont demandés. Utilise `query` pour filtrer (ex: 'is:unread', " +
        "'from:linkedin.com', 'newer_than:2d').",
      inputSchema: z.object({
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(5)
          .describe("Nombre d'emails à récupérer (1 pour le dernier)"),
        query: z
          .string()
          .optional()
          .describe("Requête de recherche Gmail optionnelle (syntaxe Gmail)"),
      }),
      execute: async ({ maxResults, query }) => {
        try {
          const emails = await listGmailMessages(teamId, { maxResults, q: query });
          return { count: emails.length, emails: emails.map(compact) };
        } catch (e) {
          return gmailError(e);
        }
      },
    });
  }

  if (caps.send) {
    tools.gmail_send = tool({
      description:
        "Envoyer un email depuis le compte Gmail de l'utilisateur. N'envoie que lorsque le " +
        "destinataire, le sujet et le corps sont explicites ; sinon demande d'abord les manquants.",
      inputSchema: z.object({
        to: z.string().describe("Adresse email du destinataire"),
        subject: z.string().describe("Sujet"),
        body: z.string().describe("Corps du message"),
      }),
      execute: async ({ to, subject, body }) => {
        try {
          const { transport } = await deliverEmail(teamId, {
            from: DEFAULT_MAIL_FROM,
            to,
            subject: subject.replace(/[\r\n]+/g, " ").trim(),
            text: body,
          });
          return { delivered: true, transport, to, subject };
        } catch (e) {
          return gmailError(e);
        }
      },
    });
  }

  return tools;
}
