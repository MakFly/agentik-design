import type { AgentConfig } from "@/types/domain";

/**
 * Merge a possibly-partial config over the defaults so every nested object
 * (`model`, `limits`, `retry`, `guardrails`) is always present. Guards against a
 * config that exists but is incomplete — an identity-only/never-published agent,
 * or a localStorage draft from an older schema — which would otherwise crash
 * `validateDraft`/`patchModel` on `config.model.…`. A plain `?? defaultAgentConfig()`
 * is all-or-nothing and misses these.
 */
export function normalizeAgentConfig(config?: Partial<AgentConfig> | null): AgentConfig {
  const base = defaultAgentConfig();
  if (!config) return base;
  return {
    ...base,
    ...config,
    model: { ...base.model, ...config.model },
    limits: { ...base.limits, ...config.limits },
    retry: { ...base.retry, ...config.retry },
    guardrails: { ...base.guardrails, ...config.guardrails },
  };
}

/** A valid, safe starting point for a new agent draft (docs/01 §4.2). */
export function defaultAgentConfig(): AgentConfig {
  return {
    runtimeKind: "claude",
    runtimeBinding: { daemonId: null },
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      temperature: 0.2,
      maxTokens: 2048,
      topP: 1,
      reasoningEffort: "medium",
      jsonMode: false,
    },
    systemPrompt: "You are a helpful assistant.\n\nFollow the user's instructions precisely and cite sources when available.",
    promptVariables: [],
    tools: [],
    memory: [],
    limits: {
      requestsPerMin: 60,
      maxConcurrentRuns: 5,
      maxTokensPerRun: 8000,
      maxCostPerRun: { amountCents: 20, currency: "USD" },
      timeoutMs: 60_000,
    },
    retry: {
      maxAttempts: 2,
      backoff: "exponential",
      initialDelayMs: 500,
      retryOn: ["timeout", "rate_limit", "provider_error"],
    },
    guardrails: {
      redactPII: true,
      blockedActions: [],
      requireApprovalFor: [],
      egressAllowlist: [],
      contentFilters: ["prompt_injection", "secrets"],
    },
  };
}
