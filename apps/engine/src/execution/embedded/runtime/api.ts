/**
 * API runtime adapter — the zero-install solo path. Calls a provider directly via
 * the Vercel AI SDK (same providers as infra/llm.ts) using a key resolved from the
 * task env (the org's provider keys, injected by claimTask). One key is enough.
 */
import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { readTaskInput, type RuntimeAdapter } from "./types";

export interface ApiProvider {
  provider: "anthropic" | "openai" | "google";
  envVar: string;
  defaultModel: string;
}

const PROVIDERS: ApiProvider[] = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-6" },
  { provider: "openai", envVar: "OPENAI_API_KEY", defaultModel: "gpt-5.4-mini" },
  { provider: "google", envVar: "GOOGLE_API_KEY", defaultModel: "gemini-2.0-flash" },
];

const KIND_PROVIDER: Record<string, ApiProvider["provider"]> = {
  claude: "anthropic",
  anthropic: "anthropic",
  codex: "openai",
  openai: "openai",
  google: "google",
  gemini: "google",
};

/**
 * Pick a usable provider: prefer the runtime kind's natural provider when its key
 * is present, else the first provider with a key. Null when no key is available.
 */
export function resolveApiProvider(
  kind: string,
  env: Record<string, string>,
): ApiProvider | null {
  const preferred = KIND_PROVIDER[kind];
  const ordered = preferred
    ? [...PROVIDERS].sort((a, b) =>
        a.provider === preferred ? -1 : b.provider === preferred ? 1 : 0,
      )
    : PROVIDERS;
  return ordered.find((p) => env[p.envVar]) ?? null;
}

function buildModel(
  p: ApiProvider,
  model: string,
  apiKey: string,
): LanguageModel {
  switch (p.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
  }
}

export function apiAdapter(p: ApiProvider): RuntimeAdapter {
  return {
    label: `api:${p.provider}`,
    async run(task, emit, signal) {
      const env = task.env ?? {};
      const apiKey = env[p.envVar];
      if (!apiKey) throw new Error(`missing ${p.envVar}`);
      const { prompt, systemPrompt, model } = readTaskInput(task);
      if (!prompt.trim()) throw new Error("empty prompt");

      const { text, usage } = await generateText({
        model: buildModel(p, model ?? p.defaultModel, apiKey),
        system: systemPrompt,
        prompt,
        abortSignal: signal,
      });

      await emit([{ seq: 1, type: "text", content: text }]);
      return {
        result: {
          summary: text.slice(0, 280),
          model: model ?? p.defaultModel,
          usage,
        },
      };
    },
  };
}
