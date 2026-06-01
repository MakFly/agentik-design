/** Model catalog for the Agent Builder model section (docs/01 §4.2). */
export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  /** USD price per 1M tokens, for the inline cost hint */
  inPerM: number;
  outPerM: number;
  maxOutput: number;
  reasoning?: boolean;
}

export const MODEL_CATALOG: ModelOption[] = [
  { provider: "anthropic", model: "claude-opus-4", label: "Claude Opus 4", inPerM: 15, outPerM: 75, maxOutput: 8192, reasoning: true },
  { provider: "anthropic", model: "claude-sonnet-4", label: "Claude Sonnet 4", inPerM: 3, outPerM: 15, maxOutput: 8192, reasoning: true },
  { provider: "anthropic", model: "claude-haiku-4.5", label: "Claude Haiku 4.5", inPerM: 0.8, outPerM: 4, maxOutput: 8192 },
  { provider: "openai", model: "gpt-4o", label: "GPT-4o", inPerM: 2.5, outPerM: 10, maxOutput: 16384 },
  { provider: "openai", model: "o4-mini", label: "o4-mini", inPerM: 1.1, outPerM: 4.4, maxOutput: 16384, reasoning: true },
];

export const PROVIDERS = [...new Set(MODEL_CATALOG.map((m) => m.provider))];

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
