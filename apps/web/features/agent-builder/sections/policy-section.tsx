"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { RetryPolicy } from "@/types/domain";
import { useBuilderStore } from "../store-context";
import type { Issue } from "../validation";
import { fieldRow, FieldError, SectionWarnings, SectionHeading } from "./section-kit";

const RETRY_ON: Array<RetryPolicy["retryOn"][number]> = ["timeout", "rate_limit", "provider_error", "tool_error"];

function csv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function PolicySection({ issues }: { issues: Issue[] }) {
  const config = useBuilderStore((s) => s.config);
  const patchLimits = useBuilderStore((s) => s.patchLimits);
  const patchRetry = useBuilderStore((s) => s.patchRetry);
  const patchGuardrails = useBuilderStore((s) => s.patchGuardrails);
  const l = config.limits;
  const r = config.retry;
  const g = config.guardrails;

  const filters: Array<{ key: "toxicity" | "secrets" | "prompt_injection"; label: string }> = [
    { key: "prompt_injection", label: "Prompt injection" },
    { key: "secrets", label: "Secret leakage" },
    { key: "toxicity", label: "Toxicity" },
  ];
  const toggleFilter = (key: "toxicity" | "secrets" | "prompt_injection", on: boolean) => {
    const set = new Set(g.contentFilters);
    if (on) set.add(key);
    else set.delete(key);
    patchGuardrails({ contentFilters: [...set] });
  };
  const toggleRetryOn = (key: RetryPolicy["retryOn"][number], on: boolean) => {
    const set = new Set(r.retryOn);
    if (on) set.add(key);
    else set.delete(key);
    patchRetry({ retryOn: [...set] });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <SectionHeading title="Policy & approval" hint="Limits, retries, and the guardrails that gate risky actions." />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Limits</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className={fieldRow}>
            <Label htmlFor="rpm">Requests / min</Label>
            <Input id="rpm" type="number" min={1} value={l.requestsPerMin} onChange={(e) => patchLimits({ requestsPerMin: Number(e.target.value) })} />
          </div>
          <div className={fieldRow}>
            <Label htmlFor="conc">Max concurrent runs</Label>
            <Input id="conc" type="number" min={1} value={l.maxConcurrentRuns} onChange={(e) => patchLimits({ maxConcurrentRuns: Number(e.target.value) })} />
          </div>
          <div className={fieldRow}>
            <Label htmlFor="mtpr">Max tokens / run</Label>
            <Input id="mtpr" type="number" min={1} step={500} value={l.maxTokensPerRun} onChange={(e) => patchLimits({ maxTokensPerRun: Number(e.target.value) })} />
          </div>
          <div className={fieldRow}>
            <Label htmlFor="cap">Max cost / run (cents)</Label>
            <Input
              id="cap"
              type="number"
              min={1}
              value={l.maxCostPerRun.amountCents}
              aria-invalid={issues.some((i) => i.field === "maxCostPerRun")}
              onChange={(e) => patchLimits({ maxCostPerRun: { amountCents: Number(e.target.value), currency: "USD" } })}
            />
            <FieldError issues={issues} field="maxCostPerRun" />
          </div>
          <div className={fieldRow}>
            <Label htmlFor="timeout">Timeout (ms)</Label>
            <Input id="timeout" type="number" min={1000} step={1000} value={l.timeoutMs} onChange={(e) => patchLimits({ timeoutMs: Number(e.target.value) })} />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border p-3">
        <h3 className="mb-3 text-sm font-medium">Retry policy</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className={fieldRow}>
            <Label htmlFor="attempts">Max attempts</Label>
            <Input id="attempts" type="number" min={1} max={10} value={r.maxAttempts} onChange={(e) => patchRetry({ maxAttempts: Number(e.target.value) })} />
          </div>
          <div className={fieldRow}>
            <Label htmlFor="backoff">Backoff</Label>
            <Select value={r.backoff} onValueChange={(v) => patchRetry({ backoff: v as "fixed" | "exponential" })}>
              <SelectTrigger id="backoff">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="exponential">Exponential</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={fieldRow}>
            <Label htmlFor="delay">Initial delay (ms)</Label>
            <Input id="delay" type="number" min={0} step={100} value={r.initialDelayMs} onChange={(e) => patchRetry({ initialDelayMs: Number(e.target.value) })} />
          </div>
        </div>
        <fieldset className="mt-3">
          <legend className="text-xs text-muted-foreground">Retry on</legend>
          <div className="mt-1.5 flex flex-wrap gap-3">
            {RETRY_ON.map((key) => (
              <label key={key} className="flex min-h-[44px] items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={r.retryOn.includes(key)} onCheckedChange={(c) => toggleRetryOn(key, c === true)} />
                {key}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium">Guardrails</h3>
        <label className="flex items-center justify-between rounded-md border border-border p-3">
          <span className="flex flex-col">
            <span className="text-sm font-medium">Redact PII</span>
            <span className="text-xs text-muted-foreground">Strip personal data before it reaches the model.</span>
          </span>
          <Switch checked={g.redactPII} onCheckedChange={(redactPII) => patchGuardrails({ redactPII })} />
        </label>

        <fieldset className="rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Content filters</legend>
          <div className="mt-2 flex flex-col gap-2">
            {filters.map((f) => (
              <label key={f.key} className="flex min-h-[44px] items-center justify-between">
                <span className="text-sm">{f.label}</span>
                <Switch checked={g.contentFilters.includes(f.key)} onCheckedChange={(on) => toggleFilter(f.key, on)} />
              </label>
            ))}
          </div>
        </fieldset>

        <div className={fieldRow}>
          <Label htmlFor="approvalFor">Require approval for</Label>
          <Input
            id="approvalFor"
            value={g.requireApprovalFor.join(", ")}
            onChange={(e) => patchGuardrails({ requireApprovalFor: csv(e.target.value) })}
            placeholder="deploy, send_email, force_push"
          />
          <p className="text-xs text-muted-foreground">Action keys that pause the run for human approval.</p>
        </div>

        <div className={fieldRow}>
          <Label htmlFor="blocked">Blocked actions</Label>
          <Input
            id="blocked"
            value={g.blockedActions.join(", ")}
            onChange={(e) => patchGuardrails({ blockedActions: csv(e.target.value) })}
            placeholder="db_drop, prod_write"
          />
          <p className="text-xs text-muted-foreground">Action keys the agent may never perform.</p>
        </div>

        <div className={fieldRow}>
          <Label htmlFor="egress">Egress allowlist</Label>
          <Input
            id="egress"
            value={g.egressAllowlist.join(", ")}
            onChange={(e) => patchGuardrails({ egressAllowlist: csv(e.target.value) })}
            placeholder="api.stripe.com, hooks.slack.com"
          />
          <p className="text-xs text-muted-foreground">Comma-separated domains the agent may reach.</p>
        </div>
      </section>
      <SectionWarnings issues={issues} />
    </div>
  );
}
