import type { HermesRunRequest, HermesRunResult, HermesRunStep } from "@/features/hermes-lite/types";
import { getScenario } from "@/features/hermes-lite/catalog";

export const dynamic = "force-dynamic";

const OPENAI_URL = "https://api.openai.com/v1/responses";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<HermesRunRequest>;
  const payload = normalizePayload(body);
  const scenario = getScenario(payload.scenarioId);
  const key = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI ?? process.env.OPEN_AI_KEY;

  if (!key) {
    return Response.json(buildFallback(payload, "fallback"));
  }

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        max_output_tokens: 1400,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Tu es Hermes Lite pour TPE/PME. Retourne uniquement un JSON valide. Tu ne promets jamais d'action irréversible. Tu privilégies isolement, validation humaine, notifications et mémoire minimale.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  expectedShape: {
                    title: "string",
                    summary: "string",
                    riskLevel: "low|medium|high",
                    confidence: "number 0..100",
                    estimatedTimeSaved: "string",
                    nextBestAction: "string",
                    approvalRequired: "boolean",
                    steps: [
                      {
                        title: "string",
                        owner: "agent|operator|tool",
                        status: "ready|approval|blocked",
                        detail: "string",
                        tool: "string optional",
                      },
                    ],
                    notifications: ["string"],
                    customerMessage: "string",
                    memoryWrite: "string",
                    guardrails: ["string"],
                  },
                  company: {
                    name: payload.companyName,
                    size: payload.companySize,
                    tone: payload.tone,
                    isolation: payload.isolation,
                  },
                  scenario,
                  request: payload.request,
                }),
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return Response.json(buildFallback(payload, "fallback"), { status: 200 });
    }

    const data = await response.json();
    const parsed = parseModelJson(extractOutputText(data));
    return Response.json(coerceResult(parsed, payload));
  } catch {
    return Response.json(buildFallback(payload, "fallback"));
  }
}

function normalizePayload(body: Partial<HermesRunRequest>): HermesRunRequest {
  return {
    companyName: String(body.companyName || "Ma société").slice(0, 80),
    companySize: body.companySize === "solo" || body.companySize === "pme" ? body.companySize : "tpe",
    scenarioId: body.scenarioId ?? "artisan",
    request: String(body.request || "").slice(0, 1800),
    tone: body.tone === "direct" || body.tone === "premium" ? body.tone : "warm",
    isolation:
      body.isolation === "auto-low-risk" || body.isolation === "sandbox"
        ? body.isolation
        : "approval-first",
  };
}

function extractOutputText(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const record = data as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return "";

  return record.output
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((content) => {
      if (typeof content !== "object" || content === null) return "";
      const value = content as { text?: unknown };
      return typeof value.text === "string" ? value.text : "";
    })
    .join("");
}

function parseModelJson(text: string): Partial<HermesRunResult> | null {
  try {
    return JSON.parse(text) as Partial<HermesRunResult>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Partial<HermesRunResult>;
    } catch {
      return null;
    }
  }
}

function coerceResult(parsed: Partial<HermesRunResult> | null, payload: HermesRunRequest): HermesRunResult {
  const fallback = buildFallback(payload, "openai");
  if (!parsed) return fallback;

  return {
    source: "openai",
    title: stringOr(parsed.title, fallback.title),
    summary: stringOr(parsed.summary, fallback.summary),
    riskLevel:
      parsed.riskLevel === "low" || parsed.riskLevel === "high" || parsed.riskLevel === "medium"
        ? parsed.riskLevel
        : fallback.riskLevel,
    confidence: clampNumber(parsed.confidence, 0, 100, fallback.confidence),
    estimatedTimeSaved: stringOr(parsed.estimatedTimeSaved, fallback.estimatedTimeSaved),
    nextBestAction: stringOr(parsed.nextBestAction, fallback.nextBestAction),
    approvalRequired: typeof parsed.approvalRequired === "boolean" ? parsed.approvalRequired : fallback.approvalRequired,
    steps: Array.isArray(parsed.steps) && parsed.steps.length ? parsed.steps.slice(0, 6).map(coerceStep) : fallback.steps,
    notifications: coerceStringArray(parsed.notifications, fallback.notifications),
    customerMessage: stringOr(parsed.customerMessage, fallback.customerMessage),
    memoryWrite: stringOr(parsed.memoryWrite, fallback.memoryWrite),
    guardrails: coerceStringArray(parsed.guardrails, fallback.guardrails),
  };
}

function buildFallback(payload: HermesRunRequest, source: HermesRunResult["source"]): HermesRunResult {
  const scenario = getScenario(payload.scenarioId);
  const approvalRequired = payload.isolation !== "auto-low-risk" || scenario.approvalPolicy.toLowerCase().includes("validation");
  const steps: HermesRunStep[] = [
    {
      title: "Qualifier la demande",
      owner: "agent",
      status: "ready",
      detail: `Classer le message dans ${scenario.category} et extraire urgence, client, budget, délai et pièces manquantes.`,
      tool: scenario.tools[0],
    },
    {
      title: "Préparer le plan d'action",
      owner: "agent",
      status: "ready",
      detail: scenario.automations.slice(0, 3).join(", "),
      tool: scenario.tools[1],
    },
    {
      title: "Contrôle humain",
      owner: "operator",
      status: approvalRequired ? "approval" : "ready",
      detail: scenario.approvalPolicy,
    },
    {
      title: "Notifier l'équipe",
      owner: "tool",
      status: "ready",
      detail: `Envoyer le résumé vers ${scenario.notify.join(" et ")} avec le niveau de risque et la prochaine action.`,
      tool: "Discord / Telegram",
    },
  ];

  return {
    source,
    title: `${scenario.shortLabel}: run isolé prêt`,
    summary: `${payload.companyName} peut traiter cette demande avec un agent léger: qualification, brouillon d'action, validation humaine et notification équipe.`,
    riskLevel: approvalRequired ? "medium" : "low",
    confidence: 87,
    estimatedTimeSaved: payload.companySize === "pme" ? "35 à 50 min" : "15 à 30 min",
    nextBestAction: "Lancer en sandbox, relire le brouillon, puis activer les notifications sur le canal opérationnel.",
    approvalRequired,
    steps,
    notifications: scenario.notify,
    customerMessage: buildCustomerMessage(payload, scenario.promise),
    memoryWrite: scenario.memoryPolicy,
    guardrails: [
      "Aucune action irréversible sans validation.",
      "Secrets, paiement et données sensibles restent hors mémoire longue.",
      "Les outils externes sont simulés ou limités tant que le mode production n'est pas validé.",
    ],
  };
}

function buildCustomerMessage(payload: HermesRunRequest, promise: string): string {
  const greeting = payload.tone === "premium" ? "Bonjour," : "Bonjour";
  const closing = payload.tone === "direct" ? "Je reviens vers vous rapidement." : "Je reviens vers vous avec une réponse claire.";
  return `${greeting} nous avons bien reçu votre demande. ${promise} ${closing}`;
}

function coerceStep(step: Partial<HermesRunStep>): HermesRunStep {
  return {
    title: stringOr(step.title, "Etape Hermes"),
    owner: step.owner === "operator" || step.owner === "tool" ? step.owner : "agent",
    status: step.status === "approval" || step.status === "blocked" ? step.status : "ready",
    detail: stringOr(step.detail, "Action à préparer."),
    tool: typeof step.tool === "string" ? step.tool : undefined,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1200) : fallback;
}

function coerceStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const clean = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6);
  return clean.length ? clean : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
