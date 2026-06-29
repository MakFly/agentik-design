import { eq } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { env } from "../../../infra/env";
import { listAgentRows } from "../../runs";
import { listProjects } from "../../projects";
import type { ChannelConnectionRow, ChannelIdentityRow } from "./types";
import { formatHelpReply, formatRunHelpReply } from "./presenter";

export function normalizeAgentHandle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function agentHandle(agent: { id: string; name: string }) {
  return normalizeAgentHandle(agent.name).slice(0, 40) || agent.id;
}

export function helpText(connection: ChannelConnectionRow) {
  return formatHelpReply(connection.pairingCode);
}

export async function runHelpText(teamId: string, intro?: string) {
  const [agents, projects] = await Promise.all([
    listAgentRows(teamId),
    listProjects(teamId),
  ]);
  return formatRunHelpReply({
    intro,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      handle: agentHandle(agent),
      health: agent.health,
      model: agent.model,
    })),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      openTaskCount: project.openTaskCount,
      type: project.type,
    })),
  });
}

type AgentListRow = Awaited<ReturnType<typeof listAgentRows>>[number];

export async function resolveAgentHandle(
  teamId: string,
  handle: string,
): Promise<
  | { agent: AgentListRow }
  | { error: "ambiguous" | "not_found"; agents: AgentListRow[] }
> {
  const normalized = normalizeAgentHandle(handle);
  const agents = await listAgentRows(teamId);
  const matches = agents.filter(
    (agent) =>
      normalizeAgentHandle(agent.id) === normalized ||
      agentHandle(agent) === normalized,
  );
  if (matches.length === 1) return { agent: matches[0]! };
  if (matches.length > 1) return { error: "ambiguous" as const, agents: matches };
  return { error: "not_found" as const, agents };
}

export async function activeAgentRow(teamId: string, identity: ChannelIdentityRow) {
  if (!identity.activeAgentId) return null;
  const agents = await listAgentRows(teamId);
  return agents.find((agent) => agent.id === identity.activeAgentId) ?? null;
}

export async function webRunUrl(teamId: string, runId: string) {
  const [team] = await db
    .select({ slug: schema.teams.slug })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .limit(1);
  const teamSegment = encodeURIComponent(team?.slug ?? teamId);
  return `${env.WEB_PUBLIC_URL.replace(/\/$/, "")}/${teamSegment}/runs/${encodeURIComponent(runId)}`;
}

export function clarifyAgentReply(
  question: string,
  choices: Array<{ handle: string; label: string }>,
) {
  return [
    question,
    ...choices.map((choice) => `/run @${choice.handle} "ta demande" · ${choice.label}`),
    "",
    "Astuce : envoie /agent @agent_handle pour garder un agent par défaut dans ce chat.",
  ].join("\n");
}
