import type { Provider } from "@/features/settings/types";
import { PROVIDER_MODELS } from "@agentik/workflow-schema";

const usd = (amountCents: number) => ({ amountCents, currency: "USD" as const });

// ── Providers ─────────────────────────────────────────────────────────────
export const providers: Provider[] = [
  { id: "prov_anthropic", kind: "anthropic", label: "Anthropic", status: "active", hasKey: true, models: PROVIDER_MODELS.anthropic ?? [], isDefault: true },
  { id: "prov_openai", kind: "openai", label: "OpenAI", status: "active", hasKey: true, models: PROVIDER_MODELS.openai ?? [], isDefault: false },
  { id: "prov_selfhosted", kind: "self-hosted", label: "Self-hosted", status: "off", hasKey: false, models: [], isDefault: false, baseUrl: "https://llm.internal" },
];

export const fallbackOrder = ["prov_anthropic", "prov_openai"];
export const costCeilingPerDay = usd(20000); // $200/day
