"use client";

import type { AgentConfig } from "@/types/domain";
import { KeyValueList } from "@/components/shared/key-value-list";
import { findModel, estimateRunCents } from "@/config/models";
import { formatMoney } from "@/lib/format";

/** Resolved-config summary shown above the test harness (docs/01 §4.2). */
export function ConfigPreview({ config }: { config: AgentConfig }) {
  const meta = findModel(config.model.model);
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Resolved config</h3>
      <KeyValueList
        items={[
          { label: "Model", value: meta?.label ?? config.model.model },
          { label: "Temperature", value: config.model.temperature },
          { label: "Tools", value: config.tools.length },
          { label: "Memory", value: config.memory.length ? `${config.memory.length} store(s)` : "none" },
          { label: "Guardrails", value: `${config.guardrails.contentFilters.length} filters${config.guardrails.redactPII ? " · PII" : ""}` },
          { label: "Cost cap", value: formatMoney(config.limits.maxCostPerRun) },
          { label: "Est. / run", value: formatMoney({ amountCents: estimateRunCents(config.model.model), currency: "USD" }) },
        ]}
      />
    </div>
  );
}
