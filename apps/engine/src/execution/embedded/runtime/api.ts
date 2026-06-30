/**
 * API runtime adapter — the zero-install solo path. Calls a provider directly via
 * the Vercel AI SDK (same providers as infra/llm.ts) using a key resolved from the
 * task env (the org's provider keys, injected by claimTask). One key is enough.
 */
import { streamText, type LanguageModel } from "ai";

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;
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

/** The provider a runtime kind natively targets (so a stored model id is valid for it). */
export function naturalProviderForKind(kind: string): ApiProvider["provider"] | undefined {
  return KIND_PROVIDER[kind];
}

/** Infer a model id's provider from its prefix — used to guard a cross-provider /model override. */
export function providerOfModel(model: string): ApiProvider["provider"] | undefined {
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o[1-9])/i.test(model)) return "openai";
  if (/^gemini/i.test(model)) return "google";
  return undefined;
}

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

export function buildModel(
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

/** Reasoning models surface their thinking; chat models error if asked to. */
function isOpenAiReasoningModel(model: string): boolean {
  return /^(o[1-9]|gpt-5)/i.test(model);
}

/**
 * Ask the provider to stream its reasoning so the chat can show a live "thinking"
 * block. Guarded per provider — OpenAI only on reasoning models (else the API rejects
 * `reasoningSummary`). Returns undefined when reasoning isn't applicable.
 */
export function reasoningProviderOptions(
  p: ApiProvider,
  model: string,
): ProviderOptions | undefined {
  switch (p.provider) {
    case "openai":
      return isOpenAiReasoningModel(model)
        ? { openai: { reasoningSummary: "auto", reasoningEffort: "medium" } }
        : undefined;
    case "anthropic":
      return { anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } };
    case "google":
      return { google: { thinkingConfig: { includeThoughts: true } } };
  }
}

// Flush a run-message once a delta buffer reaches this size — coarse enough to keep
// task_messages row counts sane, fine enough to feel like token streaming.
const FLUSH_CHARS = 48;

export function apiAdapter(p: ApiProvider): RuntimeAdapter {
  return {
    label: `api:${p.provider}`,
    async run(task, emit, signal) {
      const env = task.env ?? {};
      const apiKey = env[p.envVar];
      if (!apiKey) throw new Error(`missing ${p.envVar}`);
      const { prompt, systemPrompt, model } = readTaskInput(task);
      if (!prompt.trim()) throw new Error("empty prompt");
      const resolvedModel = model ?? p.defaultModel;

      const result = streamText({
        model: buildModel(p, resolvedModel, apiKey),
        system: systemPrompt,
        prompt,
        abortSignal: signal,
        providerOptions: reasoningProviderOptions(p, resolvedModel),
      });

      // Coalesce deltas into ordered `text`/`thinking` rows. Reasoning streams before
      // the answer, so flushing the pending buffer whenever the kind switches keeps the
      // persisted order (thinking… then text…) that the chat replays as reasoning→reply.
      let seq = 0;
      const pending: { type: "text" | "thinking" | null; buf: string } = {
        type: null,
        buf: "",
      };
      const flush = async () => {
        if (!pending.type || !pending.buf) return;
        seq += 1;
        await emit([{ seq, type: pending.type, content: pending.buf }]);
        pending.type = null;
        pending.buf = "";
      };
      const push = async (type: "text" | "thinking", text: string) => {
        if (pending.type && pending.type !== type) await flush();
        pending.type = type;
        pending.buf += text;
        if (pending.buf.length >= FLUSH_CHARS) await flush();
      };

      for await (const part of result.fullStream) {
        if (signal.aborted) break;
        if (part.type === "text-delta") await push("text", part.text);
        else if (part.type === "reasoning-delta") await push("thinking", part.text);
      }
      await flush();

      const text = await result.text;
      const usage = await result.usage;
      // `result` carries the assistant turn text (resultText() reads result.result);
      // the rest is metadata for cost/observability.
      return {
        result: {
          result: text,
          summary: text.slice(0, 280),
          model: resolvedModel,
          usage,
        },
      };
    },
  };
}
