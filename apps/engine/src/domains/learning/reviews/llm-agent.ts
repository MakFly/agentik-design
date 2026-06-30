import { generateObject } from "ai";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { reviewAgentOutput, type ReviewAgentOutput } from "@agentik/workflow-schema";
import { resolveProviderEnv } from "../../settings/providers-repo";
import { resolveApiProvider, buildModel } from "../../../execution/embedded/runtime/api";
import type { ReviewInput } from "./agent";

const { skills, skillVersions } = schema;

/** The agent's own skills (id, name, current body) so the reviewer can patch — not duplicate — them. */
async function agentSkillsWithBody(teamId: string, agentId: string) {
  return db
    .select({ id: skills.id, name: skills.name, body: skillVersions.bodyMd })
    .from(skills)
    .leftJoin(skillVersions, eq(skillVersions.id, skills.currentVersionId))
    .where(and(eq(skills.teamId, teamId), eq(skills.scope, "agent"), eq(skills.targetId, agentId)));
}

/**
 * LLM-backed Review Agent (Hermes `background_review` model): reads a finished run's transcript
 * and proposes durable memories + skill create/patch changes — PROPOSE-ONLY, applied only on
 * human approval via `applyRunReview`. Returns null when no provider key is available or the
 * call fails, so the caller falls back to the deterministic reviewer. Same `ReviewAgentOutput`
 * contract the deterministic reviewer emits.
 */
export async function llmReview(
  teamId: string,
  input: ReviewInput,
  runtimeKind: string,
): Promise<ReviewAgentOutput | null> {
  const env = await resolveProviderEnv(teamId);
  const provider = resolveApiProvider(runtimeKind, env);
  if (!provider) return null;
  const apiKey = env[provider.envVar];
  if (!apiKey) return null;

  const existing = await agentSkillsWithBody(teamId, input.agentId);
  const transcript = input.messages
    .map((m) => `[${m.type}${m.tool ? `:${m.tool}` : ""}] ${(m.content ?? "").slice(0, 1500)}`)
    .join("\n")
    .slice(0, 12000);

  const system =
    "Tu es un agent de revue (self-improvement, modèle Hermes background_review). À partir de la " +
    "trace d'un run terminé, propose — SANS RIEN APPLIQUER — des mémoires durables et des skills " +
    "(procédures réutilisables) à créer ou améliorer. Sois conservateur : ne propose que ce qui est " +
    "concret et réutilisable au-delà de ce run précis. Si rien d'utile, renvoie des listes vides " +
    "(shouldCreateMemory/shouldCreateSkill=false).";
  const prompt = [
    `Statut du run : ${input.status}${input.error ? ` — erreur : ${input.error}` : ""}`,
    `Skills existants de l'agent (pour patch ou éviter un doublon) :\n${
      existing.length
        ? existing.map((s) => `- id=${s.id} « ${s.name} » : ${(s.body ?? "").slice(0, 400)}`).join("\n")
        : "(aucun)"
    }`,
    `Trace du run :\n${transcript}`,
    `Règles de sortie :\n` +
      `- Nouveau skill : action="create" avec bodyMd, triggerConditions[], pitfalls[], verificationSteps[], scope="agent", targetId="${input.agentId}".\n` +
      `- Améliorer un skill existant : action="patch", skillId=<id ci-dessus>, oldText=<extrait EXACT du body existant>, newText=<remplacement>.\n` +
      `- Mémoires : scope="agent", targetId="${input.agentId}", confidence ∈ [0,1].`,
  ].join("\n\n");

  try {
    const { object } = await generateObject({
      model: buildModel(provider, provider.defaultModel, apiKey),
      schema: reviewAgentOutput,
      system,
      prompt,
    });
    return object;
  } catch (e) {
    // Degrade to the deterministic reviewer, but make a persistently-broken LLM reviewer
    // (rejected schema, expired key, bad model id) observable instead of silent.
    console.warn(`[learning] llmReview failed, falling back to deterministic: ${(e as Error).message}`);
    return null;
  }
}
