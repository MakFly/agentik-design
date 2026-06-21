import { getScenario } from "@/features/hermes-lite/catalog";
import type {
  HermesAgentAction,
  HermesChatMessage,
  HermesChatRequest,
  HermesChatResponse,
  HermesRunRequest,
} from "@/features/hermes-lite/types";

export const dynamic = "force-dynamic";

const OPENAI_URL = "https://api.openai.com/v1/responses";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<HermesChatRequest>;
  const context = normalizeContext(body.context);
  const messages = normalizeMessages(body.messages);
  const key = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI ?? process.env.OPEN_AI_KEY;

  if (!key) {
    return Response.json(buildFallback(context, "fallback"));
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
        max_output_tokens: 1200,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Tu es Hermes Lite, un agent conversationnel pour TPE/PME. Tu discutes avec l'operateur, tu qualifies la demande, puis tu proposes des actions executees uniquement apres clic humain. Reponds uniquement en JSON valide.",
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
                    message: "string court en francais",
                    actions: [
                      {
                        kind: "draft_reply|create_task|request_approval|send_notification",
                        label: "string",
                        description: "string",
                        requiresApproval: "boolean",
                        payload: { key: "value" },
                      },
                    ],
                    memoryWrite: "string",
                    nextQuestion: "string",
                  },
                  context: {
                    companyName: context.companyName,
                    companySize: context.companySize,
                    scenario: getScenario(context.scenarioId),
                    tone: context.tone,
                    isolation: context.isolation,
                    initialRequest: context.request,
                  },
                  conversation: messages.map(({ role, content }) => ({ role, content })),
                }),
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return Response.json(buildFallback(context, "fallback"));
    }

    const data = await response.json();
    const parsed = parseJson(extractOutputText(data));
    return Response.json(coerceResponse(parsed, context));
  } catch {
    return Response.json(buildFallback(context, "fallback"));
  }
}

function normalizeContext(context: Partial<HermesRunRequest> | undefined): HermesRunRequest {
  return {
    companyName: String(context?.companyName || "Ma societe").slice(0, 80),
    companySize: context?.companySize === "solo" || context?.companySize === "pme" ? context.companySize : "tpe",
    scenarioId: context?.scenarioId ?? "artisan",
    request: String(context?.request || "").slice(0, 1800),
    tone: context?.tone === "direct" || context?.tone === "premium" ? context.tone : "warm",
    isolation:
      context?.isolation === "sandbox" || context?.isolation === "auto-low-risk"
        ? context.isolation
        : "approval-first",
  };
}

function normalizeMessages(messages: unknown): HermesChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message): message is HermesChatMessage => {
      if (typeof message !== "object" || message === null) return false;
      const value = message as Partial<HermesChatMessage>;
      return (value.role === "user" || value.role === "assistant") && typeof value.content === "string";
    })
    .slice(-8)
    .map((message) => ({
      id: String(message.id || crypto.randomUUID()),
      role: message.role,
      content: message.content.slice(0, 1600),
    }));
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

function parseJson(text: string): Partial<HermesChatResponse> | null {
  try {
    return JSON.parse(text) as Partial<HermesChatResponse>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Partial<HermesChatResponse>;
    } catch {
      return null;
    }
  }
}

function coerceResponse(parsed: Partial<HermesChatResponse> | null, context: HermesRunRequest): HermesChatResponse {
  const fallback = buildFallback(context, "openai");
  if (!parsed) return fallback;

  return {
    source: "openai",
    message: stringOr(parsed.message, fallback.message),
    actions: Array.isArray(parsed.actions) && parsed.actions.length ? parsed.actions.slice(0, 4).map(coerceAction) : fallback.actions,
    memoryWrite: stringOr(parsed.memoryWrite, fallback.memoryWrite),
    nextQuestion: stringOr(parsed.nextQuestion, fallback.nextQuestion),
  };
}

function coerceAction(action: Partial<HermesAgentAction>, index: number): HermesAgentAction {
  const kind =
    action.kind === "draft_reply" ||
    action.kind === "create_task" ||
    action.kind === "request_approval" ||
    action.kind === "send_notification"
      ? action.kind
      : "create_task";

  return {
    id: `act_${index}_${kind}`,
    kind,
    label: stringOr(action.label, defaultLabel(kind)),
    description: stringOr(action.description, "Action preparee par Hermes."),
    requiresApproval: typeof action.requiresApproval === "boolean" ? action.requiresApproval : kind !== "create_task",
    payload: normalizePayload(action.payload),
  };
}

function buildFallback(context: HermesRunRequest, source: HermesChatResponse["source"]): HermesChatResponse {
  const scenario = getScenario(context.scenarioId);
  const subject = context.request || scenario.defaultRequest;

  return {
    source,
    message: `J'ai compris le cas ${scenario.shortLabel}. Je vais le traiter comme un agent Hermes leger: qualifier, preparer une reponse, creer une action interne, puis demander validation avant toute sortie client ou notification.`,
    actions: [
      {
        id: "act_draft_reply",
        kind: "draft_reply",
        label: "Preparer la reponse client",
        description: `Brouillon adapte au ton ${context.tone}, sans promesse irreversible.`,
        requiresApproval: true,
        payload: {
          draft: `Bonjour, nous avons bien recu votre demande. Nous verifions le dossier et revenons vers vous avec une solution claire.`,
          subject,
        },
      },
      {
        id: "act_create_task",
        kind: "create_task",
        label: "Creer une tache interne",
        description: "Assigner le dossier a un operateur avec le contexte et les pieces a verifier.",
        requiresApproval: false,
        payload: {
          owner: "Equipe operations",
          checklist: scenario.automations.slice(0, 3).join(", "),
        },
      },
      {
        id: "act_request_approval",
        kind: "request_approval",
        label: "Demander validation",
        description: scenario.approvalPolicy,
        requiresApproval: true,
        payload: {
          policy: scenario.approvalPolicy,
        },
      },
      {
        id: "act_send_notification",
        kind: "send_notification",
        label: "Notifier l'equipe",
        description: `Envoyer le resume vers ${scenario.notify.join(" et ")}.`,
        requiresApproval: true,
        payload: {
          channels: scenario.notify.join(", "),
        },
      },
    ],
    memoryWrite: scenario.memoryPolicy,
    nextQuestion: "Tu veux que j'execute quelle action en premier ?",
  };
}

function normalizePayload(payload: unknown): Record<string, string> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return {};
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 8),
  );
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 1200) : fallback;
}

function defaultLabel(kind: HermesAgentAction["kind"]): string {
  const labels: Record<HermesAgentAction["kind"], string> = {
    draft_reply: "Preparer une reponse",
    create_task: "Creer une tache",
    request_approval: "Demander validation",
    send_notification: "Notifier l'equipe",
  };
  return labels[kind];
}
