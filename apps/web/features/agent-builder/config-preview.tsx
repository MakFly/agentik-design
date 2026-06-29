"use client";

import type { AgentConfig } from "@/types/domain";
import { findModel, estimateRunCents } from "@/config/models";
import { formatMoney } from "@/lib/format";

/**
 * Live `config.yaml` preview (Hermes operator shape): the resolved draft rendered
 * as the config file a runtime would consume. Read-only mirror of the store — no
 * new fields, just a faithful projection grouped like Hermes' config.yaml.
 */
export function ConfigPreview({ config }: { config: AgentConfig }) {
  const meta = findModel(config.model.model);
  const m = config.model;
  const est = formatMoney({ amountCents: estimateRunCents(m.model), currency: "USD" });

  const lines: Array<[depth: number, key: string, value?: string]> = [
    [0, "model"],
    [1, "provider", m.provider],
    [1, "default", meta?.label ?? m.model],
    [1, "temperature", String(m.temperature)],
    [1, "max_tokens", String(m.maxTokens)],
    ...(m.reasoningEffort
      ? ([[1, "reasoning_effort", m.reasoningEffort]] as [number, string, string][])
      : []),
    [0, "execution"],
    [1, "runtime", config.runtimeKind ?? "claude"],
    [1, "computer", config.runtimeBinding?.daemonId ?? "any"],
    [0, "skills"],
    [1, "tools", String(config.tools.length)],
    [0, "memory"],
    [1, "stores", String(config.memory.length)],
    [0, "policy"],
    [1, "redact_pii", String(config.guardrails.redactPII)],
    [1, "filters", String(config.guardrails.contentFilters.length)],
    [1, "approvals", String(config.guardrails.requireApprovalFor.length)],
    [1, "cost_cap", formatMoney(config.limits.maxCostPerRun)],
  ];

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          config.yaml
        </span>
        <span
          className="font-mono text-[11px] text-muted-foreground tabular-nums"
          data-tabular
        >
          ~{est}/run
        </span>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed text-foreground">
        {lines.map(([depth, key, value], i) => (
          <div key={i}>
            <span className="text-muted-foreground">{"  ".repeat(depth)}</span>
            <span className="text-foreground">{key}</span>
            <span className="text-muted-foreground">:</span>
            {value !== undefined ? ` ${value}` : ""}
          </div>
        ))}
      </pre>
    </div>
  );
}
