/**
 * Seed the Gmail procedure as a real, editable SKILL (OpenClaw model) instead of hardcoded
 * code. It is scoped to the Gmail-capable agent so it is injected into that agent's context
 * (via buildInjectionPreamble) and shown on the Skills page — editable without a code change.
 * The actual capability is the gmail_read / gmail_send TOOLS; this skill is the *procedure*.
 *
 * Idempotent-ish: skips if a skill with the same name already exists for the team.
 * Usage:  TEAM=demo AGENT="Inbox Triage" bun run scripts/seed-gmail-skill.ts
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";
import { createSkillFromProposal, listSkills } from "../src/domains/learning";

const TEAM = process.env.TEAM ?? "demo";
const AGENT = process.env.AGENT ?? "Inbox Triage";
const SKILL_NAME = "Gmail — lecture & envoi";

async function main() {
  const [team] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, TEAM))
    .limit(1);
  if (!team) throw new Error(`team '${TEAM}' not found`);

  const existing = (await listSkills(team.id, {})).find((s) => s.name === SKILL_NAME);
  if (existing) {
    console.log(`Skill already present: ${existing.id} (${SKILL_NAME})`);
    process.exit(0);
  }

  const agents = await db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.teamId, team.id));
  const target = agents.find((a) => a.name === AGENT);
  if (!target) throw new Error(`agent '${AGENT}' not found in team '${TEAM}'`);

  const res = await createSkillFromProposal(
    team.id,
    {
      action: "create",
      skillName: SKILL_NAME,
      description: "Procédure pour lire et envoyer des emails via les outils Gmail.",
      scope: "agent",
      targetId: target.id,
      bodyMd: [
        "Tu disposes des outils `gmail_read` et `gmail_send`.",
        "",
        "- **Lire** : appelle `gmail_read`. Choisis `maxResults` selon la demande —",
        "  `1` pour « le dernier / le plus récent email », le nombre demandé sinon (défaut 5).",
        "  Utilise `query` pour filtrer (`is:unread`, `from:<domaine>`, `newer_than:2d`).",
        "  Présente la liste de façon concise : numéro, sujet, expéditeur, date.",
        "- **Envoyer** : appelle `gmail_send` seulement si destinataire, sujet et corps sont",
        "  explicites. Sinon, demande d'abord les éléments manquants — n'envoie jamais à l'aveugle.",
      ].join("\n"),
      triggerConditions: [
        "L'utilisateur demande de lire / résumer ses emails",
        "L'utilisateur demande d'envoyer un email",
      ],
      pitfalls: [
        "Ne pas renvoyer 5 emails quand un seul (« le dernier ») est demandé",
        "Ne pas envoyer un email sans destinataire/sujet/corps explicites",
      ],
      verificationSteps: [
        "Le nombre d'emails rendus correspond à la demande",
        "Un envoi n'a lieu qu'avec les trois champs présents",
      ],
    },
    undefined,
    "user",
  );
  console.log(`✅ Gmail skill created: ${res.skillId} → agent ${AGENT} (scope=agent)`);
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-gmail-skill failed:", (e as Error).message);
  process.exit(1);
});
