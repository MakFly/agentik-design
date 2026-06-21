import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type LanguageModel,
} from "ai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  DEFAULT_MODEL_ID,
  PROVIDER_ENV_KEYS,
  getModel,
  type LlmModel,
} from "@/lib/llm/registry";
import { codeTools } from "@/lib/tools/registry";

export const maxDuration = 30;

/** assistant-ui serializes a `@tool` mention as `:tool[name]` in message text. */
const TOOL_DIRECTIVE_RE = /:tool\[([^\]\n]{1,128})\](?:\{name=([^}\n]{1,128})\})?/gu;

/** Tool names `@`-mentioned in the most recent user message. */
function parseMentionedTools(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      role?: string;
      parts?: Array<{ type?: string; text?: string }>;
    };
    if (m?.role !== "user") continue;
    const text = (m.parts ?? [])
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" ");
    const names = new Set<string>();
    for (const match of text.matchAll(TOOL_DIRECTIVE_RE)) {
      names.add(match[2] ?? match[1]);
    }
    return [...names];
  }
  return [];
}

function firstEnvValue(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

// Map a catalog model to a configured provider instance, or null if its key is missing.
function resolveLanguageModel(model: LlmModel): LanguageModel | null {
  const apiKey = firstEnvValue(PROVIDER_ENV_KEYS[model.provider]);
  if (!apiKey) return null;

  switch (model.provider) {
    case "openai":
      return createOpenAI({ apiKey })(model.apiModel);
    case "anthropic":
      return createAnthropic({ apiKey })(model.apiModel);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model.apiModel);
    case "xai":
      return createXai({ apiKey })(model.apiModel);
    case "groq":
      return createGroq({ apiKey })(model.apiModel);
  }
}

function fallbackResponse(messages: unknown, text: string) {
  const stream = createUIMessageStream({
    originalMessages: messages as never,
    execute: async ({ writer }) => {
      await writer.write({ type: "text-delta", id: "fallback-text", delta: text });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

export async function POST(req: Request) {
  // assistant-ui's AssistantChatTransport forwards the selected model in `config`
  // and any client-registered (frontend) tool schemas in `tools`.
  const { messages, config, tools } = await req.json();
  const requestedId = typeof config?.modelName === "string" ? config.modelName : DEFAULT_MODEL_ID;

  const model = getModel(requestedId) ?? getModel(DEFAULT_MODEL_ID);
  const languageModel = model ? resolveLanguageModel(model) : null;

  if (!model || !languageModel) {
    const label = model?.label ?? requestedId;
    const envHint = model ? PROVIDER_ENV_KEYS[model.provider][0] : "an API key";
    return fallbackResponse(
      messages,
      `No API key configured for ${label}. Add ${envHint} to .env.local, or pick a model whose provider key is set.`,
    );
  }

  // Reasoning effort selected in the model picker (per-provider mapping).
  // OpenAI is wired end-to-end; other providers use their default effort until
  // their provider-specific option mapping is added (and a key is available to test).
  const effort = typeof config?.reasoningEffort === "string" ? config.reasoningEffort : undefined;
  const providerOptions =
    effort && model.provider === "openai" ? { openai: { reasoningEffort: effort } } : undefined;

  const toolset = { ...codeTools, ...frontendTools(tools ?? {}) };
  const available = new Set(Object.keys(toolset));

  // `@tool` mentions in the last user message scope the turn to those tools
  // (serialized as `:tool[name]` by assistant-ui's directive formatter). They
  // take precedence over the settings whitelist below.
  const mentioned = parseMentionedTools(messages).filter((n) => available.has(n));
  // Tools the user left enabled in dashboard settings (omitted when all are on).
  const settingsActive = Array.isArray(config?.activeTools)
    ? (config.activeTools as string[]).filter((n) => available.has(n))
    : undefined;
  const activeTools = mentioned.length ? mentioned : settingsActive;

  const result = streamText({
    model: languageModel,
    messages: await convertToModelMessages(messages),
    tools: toolset,
    // Restrict to mentioned tools, else the settings whitelist; undefined = all.
    ...(activeTools ? { activeTools } : undefined),
    // Without a multi-step stop condition the model stops right after a tool
    // call and never writes the final answer. Allow a few tool→text rounds.
    stopWhen: stepCountIs(8),
    ...(providerOptions ? { providerOptions } : undefined),
  });

  return result.toUIMessageStreamResponse();
}
