import type { Money } from "@/types/domain";

/** Settings domain types (docs/01 §4.10). All money is in cents. */

// ── Providers ────────────────────────────────────────────────────────────────
export type ProviderKind = "anthropic" | "openai" | "self-hosted";
export type ProviderStatus = "active" | "off" | "testing";

export interface Provider {
  id: string;
  kind: ProviderKind;
  label: string;
  status: ProviderStatus;
  /** a key is configured (write-only — value never leaves the server) */
  hasKey: boolean;
  models: string[];
  isDefault: boolean;
  /** self-hosted only */
  baseUrl?: string;
}

export interface ProvidersResponse {
  items: Provider[];
  /** provider ids in fallback priority order */
  fallbackOrder: string[];
  costCeilingPerDay: Money;
}
