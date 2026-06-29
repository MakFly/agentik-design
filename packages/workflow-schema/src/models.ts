/** Shared model catalog for agent creation and provider settings.
 *
 * Verified against official provider docs on 2026-06-26:
 * - OpenAI: https://developers.openai.com/api/docs/models
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
 * - Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
 *
 * Keep this file as the single source of truth. Run `bun run models:check`
 * from apps/web before release; it fails once the catalog is older than the
 * allowed freshness window.
 */

export const MODEL_CATALOG_LAST_VERIFIED = "2026-06-26";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  /** USD price per 1M tokens, for inline cost hints. */
  inPerM: number;
  outPerM: number;
  maxOutput: number;
  contextWindow: number;
  reasoning?: boolean;
  notes?: string;
}

export const MODEL_CATALOG = [
  {
    provider: "anthropic",
    model: "claude-fable-5",
    label: "Claude Fable 5",
    inPerM: 10,
    outPerM: 50,
    maxOutput: 128_000,
    contextWindow: 1_000_000,
    reasoning: true,
    notes: "Most capable widely released Claude model.",
  },
  {
    provider: "anthropic",
    model: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    inPerM: 5,
    outPerM: 25,
    maxOutput: 128_000,
    contextWindow: 1_000_000,
    reasoning: true,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    inPerM: 3,
    outPerM: 15,
    maxOutput: 128_000,
    contextWindow: 1_000_000,
    reasoning: true,
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    inPerM: 1,
    outPerM: 5,
    maxOutput: 64_000,
    contextWindow: 200_000,
    reasoning: true,
  },
  {
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    inPerM: 5,
    outPerM: 30,
    maxOutput: 128_000,
    contextWindow: 1_050_000,
    reasoning: true,
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    label: "GPT-5.4",
    inPerM: 2.5,
    outPerM: 15,
    maxOutput: 128_000,
    contextWindow: 1_050_000,
    reasoning: true,
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    inPerM: 0.75,
    outPerM: 4.5,
    maxOutput: 128_000,
    contextWindow: 400_000,
    reasoning: true,
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    inPerM: 0.2,
    outPerM: 1.25,
    maxOutput: 128_000,
    contextWindow: 400_000,
    reasoning: true,
  },
] as const satisfies readonly ModelOption[];

export const PROVIDERS = [...new Set(MODEL_CATALOG.map((m) => m.provider))];

export const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: MODEL_CATALOG.filter((m) => m.provider === "anthropic").map((m) => m.model),
  openai: MODEL_CATALOG.filter((m) => m.provider === "openai").map((m) => m.model),
  google: ["gemini-2.0-flash"],
};

export function findModel(model: string): ModelOption | undefined {
  return MODEL_CATALOG.find((m) => m.model === model);
}

/** Rough per-run cost hint in cents, given a model and an estimated token mix. */
export function estimateRunCents(model: string, estInput = 2000, estOutput = 600): number {
  const m = findModel(model);
  if (!m) return 0;
  const dollars = (estInput / 1_000_000) * m.inPerM + (estOutput / 1_000_000) * m.outPerM;
  return Math.round(dollars * 100);
}
