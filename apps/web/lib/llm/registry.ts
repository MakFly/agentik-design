// Central catalog of selectable LLMs. Pure data — safe to import from both
// server (routing, availability) and client (selector). Each model maps to a
// provider, the exact id passed to that provider's SDK, and the env var(s) whose
// presence means the model is usable.
//
// Maintenance note: provider model ids drift as new versions ship. The ids below
// were verified against each provider's docs on 26-06-2026 (Anthropic ids from the
// authoritative Claude API reference; OpenAI / Google / xAI / Groq via their model
// docs). Re-verify when a provider ships a new generation.

export type ProviderId = "openai" | "anthropic" | "google" | "xai" | "groq";

export type EffortLevel = { id: string; name: string };

export type LlmModel = {
  /** Selector value, and what `/api/chat` receives as `config.modelName`. */
  id: string;
  /** Human-facing label. */
  label: string;
  provider: ProviderId;
  /** Exact model id passed to the provider SDK (often equal to `id`). */
  apiModel: string;
  /** Reasoning-effort levels the model supports; omit for non-reasoning models. */
  efforts?: readonly EffortLevel[];
};

const EFFORT_LMH: readonly EffortLevel[] = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
];
const EFFORT_LMHX: readonly EffortLevel[] = [...EFFORT_LMH, { id: "max", name: "Max" }];
const EFFORT_LH: readonly EffortLevel[] = [
  { id: "low", name: "Low" },
  { id: "high", name: "High" },
];

/** Env vars that, if any is set, mark a provider as usable. First match wins for the key value. */
export const PROVIDER_ENV_KEYS: Record<ProviderId, readonly string[]> = {
  openai: ["OPENAI_API_KEY", "OPEN_AI", "OPEN_AI_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  xai: ["XAI_API_KEY"],
  groq: ["GROQ_API_KEY"],
};

export const LLM_MODELS: readonly LlmModel[] = [
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai", apiModel: "gpt-5.5", efforts: EFFORT_LMH },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "openai", apiModel: "gpt-5.4", efforts: EFFORT_LMH },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai", apiModel: "gpt-5.4-mini", efforts: EFFORT_LMH },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", provider: "openai", apiModel: "gpt-5.4-nano", efforts: EFFORT_LMH },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic", apiModel: "claude-fable-5", efforts: EFFORT_LMHX },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic", apiModel: "claude-opus-4-8", efforts: EFFORT_LMHX },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", apiModel: "claude-sonnet-4-6", efforts: EFFORT_LMH },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", apiModel: "claude-haiku-4-5" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google", apiModel: "gemini-3.5-flash", efforts: EFFORT_LMH },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", apiModel: "gemini-2.5-pro", efforts: EFFORT_LMH },
  { id: "grok-4.3", label: "Grok 4.3", provider: "xai", apiModel: "grok-4.3", efforts: EFFORT_LH },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "groq", apiModel: "llama-3.3-70b-versatile" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", provider: "groq", apiModel: "openai/gpt-oss-120b", efforts: EFFORT_LMH },
];

/** Fallback when the request carries no (or an unknown) model id. */
export const DEFAULT_MODEL_ID = "gpt-5.4-mini";

export function getModel(id: string | undefined | null): LlmModel | undefined {
  if (!id) return undefined;
  return LLM_MODELS.find((m) => m.id === id);
}
