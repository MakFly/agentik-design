/**
 * Thin, PURE wrapper around the Vercel AI SDK for internal engine LLM calls.
 *
 * Used by the chat orchestrator to pick the best-fit agent for a free-form
 * message (BYOK). Kept free of any DB/domain imports so it stays a leaf in the
 * dependency graph: the caller resolves the provider/model/key and passes them in.
 *
 * Contract: `routeAgentWithLlm` NEVER throws — on any failure (no model, timeout,
 * network error, malformed output, hallucinated agent id) it returns `null` so the
 * caller can fall back to the heuristic router. The LLM is an enhancement, never a
 * single point of failure.
 */
import { generateObject, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

export type RouterAgent = {
  id: string;
  name: string;
  role?: string | null;
  goal?: string | null;
};

export type RouteDecision = {
  agentId: string;
  confidence: number;
  reason: string;
};

/** Forced structured output. `agentId` is nullable so the model can decline. */
const decisionSchema = z.object({
  agentId: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
});

const ROUTER_TIMEOUT_MS = 2_000;

function buildRouterModel(
  provider: string,
  model: string,
  apiKey: string,
): LanguageModel | null {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
    default:
      return null;
  }
}

/** Build the routing prompt from the agent roster. Pure → unit-testable. */
export function buildRoutePrompt(agents: RouterAgent[], text: string): string {
  const roster = agents
    .map(
      (a) =>
        `- id=${a.id} | ${a.name}` +
        (a.role ? ` — ${a.role}` : "") +
        (a.goal ? ` (goal: ${a.goal})` : ""),
    )
    .join("\n");
  return [
    "You route an incoming user message to the single best-fit agent from a catalog.",
    "Choose the agent whose role/goal best matches the user's intent.",
    "Return the agent's exact id. If no agent is a clear fit, return agentId=null.",
    "confidence is your certainty in [0,1].",
    "",
    "Agents:",
    roster,
    "",
    `User message: ${text}`,
  ].join("\n");
}

/**
 * Validate a raw model decision against the live roster. Pure → unit-testable.
 * Returns null for a declined route, a hallucinated id, or malformed output.
 */
export function parseRouteDecision(
  raw: unknown,
  agents: RouterAgent[],
): RouteDecision | null {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { agentId, confidence, reason } = parsed.data;
  if (!agentId) return null;
  if (!agents.some((a) => a.id === agentId)) return null; // hallucinated id
  const clamped = Math.max(
    0,
    Math.min(1, Number.isFinite(confidence) ? confidence : 0),
  );
  return { agentId, confidence: clamped, reason: reason || "llm route" };
}

export async function routeAgentWithLlm(opts: {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  agents: RouterAgent[];
  text: string;
}): Promise<RouteDecision | null> {
  if (opts.agents.length === 0) return null;
  const model = buildRouterModel(opts.provider, opts.model, opts.apiKey);
  if (!model) return null;
  try {
    const { object } = await generateObject({
      model,
      schema: decisionSchema,
      prompt: buildRoutePrompt(opts.agents, opts.text),
      temperature: 0,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    return parseRouteDecision(object, opts.agents);
  } catch {
    // network / timeout / refusal / parse failure → caller falls back to heuristic
    return null;
  }
}
