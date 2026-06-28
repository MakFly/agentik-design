import { eq } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { env } from "../../../infra/env";
import { listAgentRows } from "../../runs";
import { listProjects } from "../../projects";
import type { ChannelConnectionRow, ChannelIdentityRow } from "./types";

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
  return [
    "Agentik Telegram control",
    `Pair: /start ${connection.pairingCode}`,
    "/projects",
    "/agents",
    "/tasks project:<projectId>",
    '/run task:<taskId> ["extra instruction"]',
    '/run @agent_handle "Prompt"',
    '/orchestrate "Prompt puis second step"',
    "/agent @agent_handle",
    "/agent off",
    '/run agent:<agentId> "Prompt"',
    '/run project:<projectId> [agent:<agentId>] "Task title"',
    "/status <runId>",
    "/pause <runId>",
    "/resume <runId>",
    "/approve <runId> [reason]",
    "/reject <runId> [reason]",
    "/kill <runId>",
    '/learn project:<projectId> "confirmed project memory"',
  ].join("\n");
}

export async function runHelpText(teamId: string, intro?: string) {
  const [agents, projects] = await Promise.all([
    listAgentRows(teamId),
    listProjects(teamId),
  ]);
  const lines = [
    intro ?? "I can start an existing project task, route a free-form message, or run a published agent.",
    "",
    "Fast paths:",
    '/run task:<taskId> "optional extra instruction"',
    '/run @agent_handle "what should the agent do?"',
    '/orchestrate "ask one agent to research puis another to act"',
    "/agent @agent_handle",
    "/agent off",
    '/run agent:<agentId> "what should the agent do?"',
    '/run project:<projectId> "new task title"',
  ];
  if (agents.length) {
    lines.push(
      "",
      "Agents:",
      ...agents
        .slice(0, 6)
        .map((agent) => `${agent.name} · @${agentHandle(agent)} · ${agent.id} · ${agent.health}`),
    );
  }
  if (projects.length) {
    lines.push(
      "",
      "Projects:",
      ...projects
        .slice(0, 6)
        .map((project) => `${project.name} · ${project.id} · ${project.openTaskCount} open`),
    );
  }
  lines.push("", "Use /tasks to list open task ids.");
  return lines.join("\n");
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

export function startRunReply(agentName: string, placement: string | null, url: string) {
  return [
    `🧠 ${agentName} is on it.`,
    "I will send the result here.",
    placement ? `Using ${placement}` : null,
    `Track: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function clarifyAgentReply(
  question: string,
  choices: Array<{ handle: string; label: string }>,
) {
  return [
    question,
    ...choices.map((choice) => `/run @${choice.handle} "your request" · ${choice.label}`),
    "",
    "Tip: send /agent @agent_handle to keep one as the default hint.",
  ].join("\n");
}
