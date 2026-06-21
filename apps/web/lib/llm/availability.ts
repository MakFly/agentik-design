import "server-only";

import {
  DEFAULT_MODEL_ID,
  LLM_MODELS,
  PROVIDER_ENV_KEYS,
  type ProviderId,
} from "./registry";

// Server-only key detection. Runs during the SSR the page already does, so the
// model selector can be rendered with correct availability without any client
// fetch or loading state — zero added latency.

export function firstEnvValue(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

export function isProviderAvailable(provider: ProviderId): boolean {
  return Boolean(firstEnvValue(PROVIDER_ENV_KEYS[provider]));
}

/** `{ [modelId]: hasKey }` — passed to the client selector as a prop. */
export function getModelAvailabilityMap(): Record<string, boolean> {
  const available: Record<ProviderId, boolean> = {
    openai: isProviderAvailable("openai"),
    anthropic: isProviderAvailable("anthropic"),
    google: isProviderAvailable("google"),
    xai: isProviderAvailable("xai"),
    groq: isProviderAvailable("groq"),
  };
  return Object.fromEntries(LLM_MODELS.map((m) => [m.id, available[m.provider]]));
}

/** First model whose provider has a key, so the selector defaults to something usable. */
export function getDefaultAvailableModelId(): string {
  return LLM_MODELS.find((m) => isProviderAvailable(m.provider))?.id ?? DEFAULT_MODEL_ID;
}
