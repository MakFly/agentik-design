import { listAgentRows } from "../runs";
import { getRoster } from "../agents";
import {
  createOrchestrationRun,
  sendAgentChatTurn,
  startNextOrchestrationStep,
  type OrchestrationPlanRecord,
} from "./repo";
import { resolveRouterCredentials } from "../settings/repo";
import { routeAgentWithLlm } from "../../infra/llm";

type AgentRow = Awaited<ReturnType<typeof listAgentRows>>[number];

/** Minimum LLM confidence to auto-route; below this we fall back to the heuristic. */
const ROUTER_MIN_CONFIDENCE = 0.6;

export type OrchestratorSurface = "telegram" | "tui" | "web";

export type OrchestratorTurnInput = {
  teamId: string;
  surface: OrchestratorSurface;
  actorId: string;
  threadKey: string;
  text: string;
  agentHintId?: string | null;
  forceOrchestration?: boolean;
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
      kind: "orchestration";
      runId: string;
      childRunId?: string;
      plan: OrchestrationPlanRecord;
      reply: string;
    }
  | {
      kind: "clarify";
      question: string;
      choices: Array<{ agentId: string; handle: string; label: string }>;
    }
  | {
      kind: "error";
      error: "empty_input" | "no_published_agents" | "agent_unavailable" | "no_live_daemon";
    };

export async function sendOrchestratedTurn(
  input: OrchestratorTurnInput,
): Promise<OrchestratorTurnResult> {
  const text = input.text.trim();
  if (!text) return { kind: "error", error: "empty_input" };

  const agents = (await listAgentRows(input.teamId)).filter((agent) =>
    Boolean(agent.liveVersionId),
  );
  if (!agents.length) return { kind: "error", error: "no_published_agents" };

  // Orchestration-native narrowing: when an orchestrator is in play, route within its
  // roster. Additive — with no orchestrator (or an empty roster) candidateAgents === agents,
  // so routing is byte-identical to before.
  const candidateAgents = await resolveCandidateAgents(
    input.teamId,
    agents,
    input.agentHintId,
  );

  const plan = maybeBuildOrchestrationPlan(candidateAgents, text, input);
  if (plan) {
    const parent = await createOrchestrationRun(input.teamId, plan);
    const first = await startNextOrchestrationStep(input.teamId, parent.runId);
    return {
      kind: "orchestration",
      runId: parent.runId,
      childRunId: first && "childRunId" in first ? first.childRunId : undefined,
      plan,
      reply: `Orchestration started with ${plan.steps.length} steps.`,
    };
  }

  const decision = await chooseAgent(candidateAgents, text, input.agentHintId, input.teamId);
  if (decision.kind === "clarify") return decision;

  const turn = await sendAgentChatTurn(input.teamId, {
    agentId: decision.agent.id,
    content: text,
    creatorId: `system:${input.surface}:${input.threadKey}:agent:${decision.agent.id}`,
    title: `${input.surface} · ${decision.agent.name}`,
  });
  if ("error" in turn)
    return {
      kind: "error",
      error: turn.error === "no_live_daemon" ? "no_live_daemon" : "agent_unavailable",
    };
  return {
    kind: "run",
    runId: turn.runId,
    chatSessionId: turn.chatSessionId,
    agent: decision.agent,
    reason: decision.reason,
    confidence: decision.confidence,
  };
}

/**
 * Pick the agent set to route over. If the hint resolves to a flagged orchestrator (or
 * exactly one published orchestrator exists), narrow to that orchestrator's published
 * roster; otherwise return every published agent — identical to pre-orchestration routing.
 */
async function resolveCandidateAgents(
  teamId: string,
  agents: AgentRow[],
  hintId: string | null | undefined,
): Promise<AgentRow[]> {
  const orchestrators = agents.filter((agent) => agent.isOrchestrator);
  if (!orchestrators.length) return agents;
  const hinted = hintId ? agents.find((agent) => agent.id === hintId) : null;
  const orchestrator =
    hinted && hinted.isOrchestrator
      ? hinted
      : orchestrators.length === 1
        ? orchestrators[0]!
        : null;
  if (!orchestrator) return agents;

  const roster = await getRoster(teamId, orchestrator.id);
  if (!roster.length) return agents;
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const rosterAgents = roster
    .map((entry) => byId.get(entry.agentId))
    .filter((agent): agent is AgentRow => Boolean(agent));
  return rosterAgents.length ? rosterAgents : agents;
}

function maybeBuildOrchestrationPlan(
  agents: AgentRow[],
  text: string,
  input: OrchestratorTurnInput,
): OrchestrationPlanRecord | null {
  if (agents.length < 2) return null;
  const wantsOrchestration =
    input.forceOrchestration ||
    /\b(orchestr|multi[-\s]?agent|plusieurs agents|puis|ensuite|apres|après|then|and then)\b/i.test(text);
  if (!wantsOrchestration) return null;

  const segments = splitGoalIntoSteps(text);
  const selected: OrchestrationPlanRecord["steps"] = [];
  const used = new Set<string>();
  for (const [index, prompt] of segments.entries()) {
    const lower = normalizeText(prompt);
    const candidates = agents
      .filter((agent) => !used.has(agent.id))
      .map((agent) => ({ agent, score: scoreAgent(agent, lower, input.agentHintId) }))
      .sort((a, b) => b.score - a.score);
    const picked = candidates[0]?.agent ?? agents.find((agent) => !used.has(agent.id));
    if (!picked) break;
    used.add(picked.id);
    selected.push({
      index,
      agentId: picked.id,
      agentName: picked.name,
      prompt: prompt.trim(),
      status: "pending",
    });
  }

  if (selected.length < 2) return null;
  return {
    goal: text,
    source: input.surface,
    actorId: input.actorId,
    threadKey: input.threadKey,
    currentIndex: -1,
    steps: selected,
  };
}

function splitGoalIntoSteps(text: string) {
  const normalized = text
    .replace(/^\/?orchestrate\s+/i, "")
    .split(/\b(?:puis|ensuite|apres|après|then|and then)\b|[;]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (normalized.length >= 2) return normalized.slice(0, 6);
  return [
    `Analyze and plan: ${text}`,
    `Execute the next concrete recommendation from the analysis: ${text}`,
  ];
}

type RouteResult =
  | { kind: "run"; agent: AgentRow; reason: string; confidence: number }
  | {
      kind: "clarify";
      question: string;
      choices: Array<{ agentId: string; handle: string; label: string }>;
    };

async function chooseAgent(
  agents: AgentRow[],
  text: string,
  hintId: string | null | undefined,
  teamId: string,
): Promise<RouteResult> {
  if (agents.length === 1) {
    return {
      kind: "run",
      agent: agents[0]!,
      reason: "only published agent",
      confidence: 1,
    };
  }

  // LLM router (BYOK). On any miss — no key, low confidence, timeout, refusal —
  // we drop through to the heuristic below, so routing never hard-depends on the LLM.
  const cred = await resolveRouterCredentials(teamId);
  if (cred) {
    const decision = await routeAgentWithLlm({
      ...cred,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        goal: a.goal,
      })),
      text,
    });
    if (decision && decision.confidence >= ROUTER_MIN_CONFIDENCE) {
      const agent = agents.find((a) => a.id === decision.agentId);
      if (agent) {
        return {
          kind: "run",
          agent,
          reason: `llm: ${decision.reason}`,
          confidence: decision.confidence,
        };
      }
    }
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
