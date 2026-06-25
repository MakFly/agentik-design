"use client";

import { JsonViewer } from "@/components/shared/json-viewer";
import { KeyValueList, type KeyValueItem } from "@/components/shared/key-value-list";
import { formatDuration, formatMoney, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Span, SpanStatusCode } from "@/types/observability";
import { categoryMeta } from "./span-color";

const STATUS_BADGE: Record<SpanStatusCode, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-success/10 text-success" },
  error: { label: "Error", cls: "bg-danger/10 text-danger" },
  unset: { label: "Unset", cls: "bg-surface-2 text-muted-foreground" },
};

const EVENT_TONE: Record<string, string> = {
  warn: "bg-warning",
  error: "bg-danger",
  info: "bg-info",
};

export function SpanDetailPanel({ span, traceDurationMs }: { span: Span; traceDurationMs: number }) {
  const meta = categoryMeta(span.category);
  const badge = STATUS_BADGE[span.status];
  const Icon = meta.Icon;

  const facts: KeyValueItem[] = [
    { label: "Span ID", value: <span className="font-mono text-xs">{span.spanId}</span> },
    { label: "Service", value: span.service },
    { label: "Kind", value: <span className="capitalize">{span.kind}</span> },
    { label: "Category", value: meta.label },
    { label: "Start", value: `+${formatDuration(span.startOffsetMs)}` },
    { label: "Duration", value: formatDuration(span.durationMs) },
    { label: "% of trace", value: `${Math.round((span.durationMs / traceDurationMs) * 100)}%` },
  ];
  if (span.tokens) facts.push({ label: "Tokens", value: formatTokens(span.tokens) });
  if (span.costCents != null && span.costCents > 0) {
    facts.push({ label: "Cost", value: formatMoney({ amountCents: span.costCents, currency: "USD" }) });
  }

  const attrItems: KeyValueItem[] = Object.entries(span.attributes).map(([label, value]) => ({
    label,
    value: <span className="font-mono text-xs">{String(value)}</span>,
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("size-4 shrink-0", meta.text)} aria-hidden="true" />
          <h2 className="truncate font-mono text-sm font-semibold">{span.name}</h2>
        </div>
        <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium", badge.cls)}>
          {badge.label}
        </span>
      </header>

      {span.status === "error" && span.statusMessage ? (
        <div className="rounded-md border border-danger/30 bg-danger-surface/40 p-3">
          <p className="text-[11px] font-medium tracking-wide text-danger uppercase">Status · error</p>
          <p className="mt-1 font-mono text-xs text-foreground break-words">{span.statusMessage}</p>
        </div>
      ) : null}

      <KeyValueList items={facts} />

      {attrItems.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Attributes</h3>
          <KeyValueList items={attrItems} />
        </section>
      ) : null}

      {span.events.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Events ({span.events.length})
          </h3>
          <ol className="flex flex-col gap-1.5">
            {span.events.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className={cn("size-2 shrink-0 rounded-full", EVENT_TONE[e.level ?? "info"])} aria-hidden="true" />
                <span className="font-medium text-foreground">{e.name}</span>
                <span className="text-subtle-foreground tabular-nums" data-tabular>
                  +{formatDuration(e.timeOffsetMs)}
                </span>
                {e.attributes ? (
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {Object.entries(e.attributes).map(([k, v]) => `${k}=${v}`).join(" ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {span.io?.request !== undefined ? (
        <JsonViewer value={span.io.request} label="Request" />
      ) : null}
      {span.io?.response !== undefined ? (
        <JsonViewer value={span.io.response} label="Response" />
      ) : null}
    </div>
  );
}
