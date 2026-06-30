import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { createAgent } from "../agents/repo";

/**
 * Agent management as real LLM tools (OpenClaw model: "create a new agent from the chat").
 * The assistant can provision a reusable agent by conversing — it calls `agent_create`, which
 * goes through the SAME `createAgent` path the platform UI uses (creates + publishes v1
 * atomically, no daemon needed for API runtimes). `execute` never throws: failures come back
 * as `{ error }` so the model can relay an actionable message.
 */

const { agents } = schema;

/** Builtin skill ids an agent can be granted at creation (mirrors domains/chat/skills.ts). */
const BUILTIN_SKILLS = ["gmail.read", "gmail.send"] as const;

function agentError(e: unknown): { error: string } {
  return { error: `Opération agent impossible : ${(e as Error).message ?? String(e)}` };
}

export function buildAgentTools(teamId: string): ToolSet {
  return {
    agent_create: tool({
      description:
        "Créer un nouvel agent IA réutilisable pour l'équipe (persona avec ses instructions). " +
        "N'appelle cet outil que lorsque l'utilisateur demande explicitement de créer un agent " +
        "ET que le nom, le but et les instructions sont clairs ; sinon, demande d'abord les " +
        "éléments manquants. L'agent créé apparaît dans le sélecteur d'agents.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Nom court de l'agent (ex: « Support »)"),
        goal: z.string().describe("But / mission en une phrase"),
        instructions: z
          .string()
          .describe("Instructions système : persona, ton, règles de comportement"),
        skills: z
          .array(z.enum(BUILTIN_SKILLS))
          .optional()
          .describe("Skills builtin à accorder (ex: gmail.read pour lire les emails)"),
        runtimeKind: z
          .enum(["openai", "claude", "google"])
          .optional()
          .describe("Provider d'exécution (défaut: openai)"),
      }),
      execute: async ({ name, goal, instructions, skills, runtimeKind }) => {
        try {
          const trimmed = name.trim();
          if (!trimmed) return { error: "Le nom de l'agent est requis." };
          const [dup] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.teamId, teamId), eq(agents.name, trimmed)))
            .limit(1);
          if (dup) return { error: `Un agent nommé « ${trimmed} » existe déjà.` };

          const res = await createAgent(teamId, {
            name: trimmed,
            goal,
            config: {
              systemPrompt: instructions,
              runtimeKind: runtimeKind ?? "openai",
              skills: skills ?? [],
              tools: [],
            },
          });
          return { created: true, id: res.id, name: trimmed, version: res.version ?? 1 };
        } catch (e) {
          return agentError(e);
        }
      },
    }),

    agent_list: tool({
      description:
        "Lister les agents existants de l'équipe (nom + but) — utile pour éviter un doublon " +
        "avant d'en créer un, ou pour répondre à « quels agents ai-je ? ».",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const rows = await db
            .select({ name: agents.name, goal: agents.goal })
            .from(agents)
            .where(eq(agents.teamId, teamId))
            .limit(100);
          return { count: rows.length, agents: rows };
        } catch (e) {
          return agentError(e);
        }
      },
    }),
  };
}
