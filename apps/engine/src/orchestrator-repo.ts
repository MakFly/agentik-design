import { listAgentRows } from "./agents-repo";
import { sendAgentChatTurn } from "./chat-repo";

type AgentRow = Awaited<ReturnType<typeof listAgentRows>>[number];

export type OrchestratorSurface = "telegram" | "tui" | "web";

export type OrchestratorTurnInput = {
  teamId: string;
  surface: OrchestratorSurface;
  actorId: string;
  threadKey: string;
  text: string;
  agentHintId?: string | null;
};

export type OrchestratorTurnResult =
  | {
      kind: "run";
      runId: string;
      chatSessionId: string;
      agent: AgentRow;
      reason: string;
      confidence: number;
    }
  | {
      kind: "clarify";
      question: string;
      choices: Array<{ agentId: string; handle: string; label: string }>;
    }
  | { kind: "error"; error: "empty_input" | "no_published_agents" | "agent_unavailable" };

export async function sendOrchestratedTurn(
  input: OrchestratorTurnInput,
): Promise<OrchestratorTurnResult> {
  const text = input.text.trim();
  if (!text) return { kind: "error", error: "empty_input" };

  const agents = (await listAgentRows(input.teamId)).filter((agent) =>
    Boolean(agent.liveVersionId),
  );
  if (!agents.length) return { kind: "error", error: "no_published_agents" };

  const decision = chooseAgent(agents, text, input.agentHintId);
  if (decision.kind === "clarify") return decision;

  const turn = await sendAgentChatTurn(input.teamId, {
    agentId: decision.agent.id,
    content: text,
    creatorId: `system:${input.surface}:${input.threadKey}:agent:${decision.agent.id}`,
    title: `${input.surface} · ${decision.agent.name}`,
  });
  if ("error" in turn) return { kind: "error", error: "agent_unavailable" };
  return {
    kind: "run",
    runId: turn.runId,
    chatSessionId: turn.chatSessionId,
    agent: decision.agent,
    reason: decision.reason,
    confidence: decision.confidence,
  };
}

function chooseAgent(
  agents: AgentRow[],
  text: string,
  hintId?: string | null,
):
  | { kind: "run"; agent: AgentRow; reason: string; confidence: number }
  | {
      kind: "clarify";
      question: string;
      choices: Array<{ agentId: string; handle: string; label: string }>;
    } {
  if (agents.length === 1) {
    return {
      kind: "run",
      agent: agents[0]!,
      reason: "only published agent",
      confidence: 1,
    };
  }

  const lower = normalizeText(text);
  const scored = agents
    .map((agent) => {
      const score = scoreAgent(agent, lower, hintId);
      return { agent, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const second = scored[1];

  if (best.score >= 22 && (!second || best.score - second.score >= 8)) {
    return {
      kind: "run",
      agent: best.agent,
      reason: `matched ${agentHandle(best.agent)}`,
      confidence: Math.min(0.98, best.score / 60),
    };
  }

  const hinted = hintId ? agents.find((agent) => agent.id === hintId) : null;
  if (hinted && best.score < 22) {
    return {
      kind: "run",
      agent: hinted,
      reason: "active agent hint",
      confidence: 0.55,
    };
  }

  return {
    kind: "clarify",
    question: "Which agent should handle this?",
    choices: scored.slice(0, 4).map(({ agent }) => ({
      agentId: agent.id,
      handle: agentHandle(agent),
      label: agent.name,
    })),
  };
}

function scoreAgent(agent: AgentRow, lowerText: string, hintId?: string | null) {
  let score = hintId === agent.id ? 8 : 0;
  const haystack = normalizeText(
    [agent.name, agent.role, agent.goal, agent.runtimeKind, agent.model]
      .filter(Boolean)
      .join(" "),
  );
  const handle = agentHandle(agent);

  if (lowerText.includes(`@${handle}`) || lowerText.includes(handle.replace(/_/g, " "))) {
    score += 80;
  }

  for (const token of lowerText.split(/\s+/).filter((part) => part.length >= 4)) {
    if (haystack.includes(token)) score += 4;
  }

  if (/\b(weather|meteo|météo|forecast|temperature|température|news|actualit|recherche|chercher|search|web|source|sources)\b/.test(lowerText)) {
    if (/\b(web|search|browser|internet)\b/.test(haystack)) score += 48;
    else if (/\b(research|recherche)\b/.test(haystack)) score += 20;
  }
  if (/\b(sql|database|postgres|query|requete|requête|schema|table|migration)\b/.test(lowerText)) {
    if (/\b(sql|data|database|postgres|analyst|analyste)\b/.test(haystack)) score += 40;
  }
  if (/\b(code|bug|fix|repo|git|test|typescript|react|next|go|build)\b/.test(lowerText)) {
    if (/\b(code|dev|developer|engineer|programmer|claude|codex)\b/.test(haystack)) score += 24;
  }

  return score;
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function agentHandle(agent: Pick<AgentRow, "id" | "name">) {
  return (
    agent.name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || agent.id
  );
}
