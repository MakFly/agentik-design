import type { Provider } from "@/features/settings/types";
import type { ProviderKey } from "@/features/settings/api";
import { PROVIDER_MODELS } from "@agentik/workflow-schema";

const usd = (amountCents: number) => ({ amountCents, currency: "USD" as const });

// ── Providers ─────────────────────────────────────────────────────────────
// Mirrors the engine: one card per key family (id = `prov_<family>`), with
// `hasKey` kept in sync with the provider-keys seed below.
export const providers: Provider[] = [
  { id: "prov_anthropic", kind: "anthropic", label: "Anthropic", status: "active", hasKey: true, models: PROVIDER_MODELS.anthropic ?? [], isDefault: true },
  { id: "prov_openai", kind: "openai", label: "OpenAI", status: "active", hasKey: true, models: PROVIDER_MODELS.openai ?? [], isDefault: false },
  { id: "prov_google", kind: "self-hosted", label: "Google", status: "off", hasKey: false, models: PROVIDER_MODELS.google ?? [], isDefault: false },
];

// ── Provider keys ───────────────────────────────────────────────────────────
// The encrypted-key view of the same families. `hasKey` matches the cards above.
export const providerKeys: ProviderKey[] = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", hasKey: true, updatedAt: "2026-06-22T09:12:00.000Z" },
  { provider: "openai", envVar: "OPENAI_API_KEY", hasKey: true, updatedAt: "2026-06-20T14:30:00.000Z" },
  { provider: "google", envVar: "GOOGLE_API_KEY", hasKey: false, updatedAt: null },
];

export const fallbackOrder = ["prov_anthropic", "prov_openai"];
export const costCeilingPerDay = usd(20000); // $200/day
