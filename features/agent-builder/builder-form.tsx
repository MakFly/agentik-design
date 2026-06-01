"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { PromptEditor } from "./prompt-editor";
import { useBuilderStore } from "./store";
import { MODEL_CATALOG, PROVIDERS, findModel, estimateRunCents } from "@/config/models";
import type { BuilderSectionKey, Issue } from "./validation";
import { issuesForSection } from "./validation";
import { formatMoney } from "@/lib/format";

function FieldError({ issues, field }: { issues: Issue[]; field?: string }) {
  const issue = issues.find((i) => i.field === field && i.severity === "error");
  if (!issue) return null;
  return (
    <p id={field ? `${field}-error` : undefined} className="text-xs text-danger">
      {issue.message}
    </p>
  );
}

function SectionWarnings({ issues }: { issues: Issue[] }) {
  const warnings = issues.filter((i) => i.severity === "warning");
  if (!warnings.length) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning-surface/40 p-3">
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {w.message}
        </p>
      ))}
    </div>
  );
}

const fieldRow = "flex flex-col gap-1.5";

export function BuilderForm({ section, issues }: { section: BuilderSectionKey; issues: Issue[] }) {
  const sectionIssues = issuesForSection(issues, section);

  switch (section) {
    case "identity":
      return <IdentitySection issues={sectionIssues} />;
    case "model":
      return <ModelSection issues={sectionIssues} />;
    case "prompt":
      return <PromptSection issues={sectionIssues} />;
    case "tools":
      return <ToolsSection issues={sectionIssues} />;
    case "memory":
      return <MemorySection />;
    case "limits":
      return <LimitsSection issues={sectionIssues} />;
    case "guardrails":
      return <GuardrailsSection issues={sectionIssues} />;
    case "review":
      return <ReviewSection issues={issues} />;
  }
}

function IdentitySection({ issues }: { issues: Issue[] }) {
  const { identity, patchIdentity } = useBuilderStore();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className={fieldRow}>
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={identity.name} aria-invalid={issues.some((i) => i.field === "name")} aria-describedby="name-error" onChange={(e) => patchIdentity({ name: e.target.value })} placeholder="Support Triage Agent" />
        <FieldError issues={issues} field="name" />
      </div>
      <div className={fieldRow}>
        <Label htmlFor="role">Role</Label>
        <Input id="role" value={identity.role} aria-invalid={issues.some((i) => i.field === "role")} aria-describedby="role-error" onChange={(e) => patchIdentity({ role: e.target.value })} placeholder="Tier-1 support triage" />
        <FieldError issues={issues} field="role" />
      </div>
      <div className={fieldRow}>
        <Label htmlFor="goal">Goal</Label>
        <Input id="goal" value={identity.goal} onChange={(e) => patchIdentity({ goal: e.target.value })} placeholder="Classify & route tickets, escalate billing issues" />
      </div>
      <SectionWarnings issues={issues} />
    </div>
  );
}

function ModelSection({ issues }: { issues: Issue[] }) {
  const { config, patchModel } = useBuilderStore();
  const m = config.model;
  const meta = findModel(m.model);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className={fieldRow}>
        <Label htmlFor="model">Model</Label>
        <Select value={m.model} onValueChange={(model) => patchModel({ model, provider: findModel(model)?.provider ?? m.provider })}>
          <SelectTrigger id="model">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectGroup key={p}>
                <SelectLabel className="capitalize">{p}</SelectLabel>
                {MODEL_CATALOG.filter((x) => x.provider === p).map((x) => (
                  <SelectItem key={x.model} value={x.model}>
                    {x.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {meta ? (
          <p className="text-xs text-muted-foreground tabular-nums" data-tabular>
            ${meta.inPerM}/M in · ${meta.outPerM}/M out · ~{formatMoney({ amountCents: estimateRunCents(m.model), currency: "USD" })}/run est.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={fieldRow}>
          <Label htmlFor="temperature">Temperature</Label>
          <Input id="temperature" type="number" step="0.1" min={0} max={2} value={m.temperature} aria-invalid={issues.some((i) => i.field === "temperature")} onChange={(e) => patchModel({ temperature: Number(e.target.value) })} />
          <FieldError issues={issues} field="temperature" />
        </div>
        <div className={fieldRow}>
          <Label htmlFor="maxTokens">Max tokens</Label>
          <Input id="maxTokens" type="number" min={1} max={meta?.maxOutput ?? 8192} value={m.maxTokens} aria-invalid={issues.some((i) => i.field === "maxTokens")} onChange={(e) => patchModel({ maxTokens: Number(e.target.value) })} />
          <FieldError issues={issues} field="maxTokens" />
        </div>
      </div>

      {meta?.reasoning ? (
        <div className={fieldRow}>
          <Label htmlFor="reasoning">Reasoning effort</Label>
          <Select value={m.reasoningEffort ?? "medium"} onValueChange={(v) => patchModel({ reasoningEffort: v as "low" | "medium" | "high" })}>
            <SelectTrigger id="reasoning" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <label className="flex items-center justify-between rounded-md border border-border p-3">
        <span className="flex flex-col">
          <span className="text-sm font-medium">JSON mode</span>
          <span className="text-xs text-muted-foreground">Force structured JSON output.</span>
        </span>
        <Switch checked={m.jsonMode ?? false} onCheckedChange={(jsonMode) => patchModel({ jsonMode })} />
      </label>
    </div>
  );
}

function PromptSection({ issues }: { issues: Issue[] }) {
  const { config, setSystemPrompt } = useBuilderStore();
  return (
    <div className="flex flex-col gap-3">
      <Label>System prompt</Label>
      <PromptEditor value={config.systemPrompt} onChange={setSystemPrompt} invalid={issues.some((i) => i.field === "systemPrompt")} />
      <FieldError issues={issues} field="systemPrompt" />
    </div>
  );
}

function ToolsSection({ issues }: { issues: Issue[] }) {
  const { config } = useBuilderStore();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      {config.tools.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          No tools granted. Connect tools in Tool Management, then grant them here with least-privilege scopes.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {config.tools.map((t) => (
            <li key={t.toolId} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <span className="font-mono">{t.toolId}</span>
              <span className="flex gap-1">
                {t.scopes.map((s) => (
                  <code key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">
                    {s}
                  </code>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <SectionWarnings issues={issues} />
    </div>
  );
}

function MemorySection() {
  const { config } = useBuilderStore();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      {config.memory.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          No memory bound. Attach a vector store to enable retrieval-augmented answers with citations.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {config.memory.map((mb) => (
            <li key={mb.storeId} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <span className="font-mono">{mb.storeId}</span>
              <span className="text-muted-foreground tabular-nums" data-tabular>
                {mb.mode} · top-{mb.topK}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LimitsSection({ issues }: { issues: Issue[] }) {
  const { config, patchLimits, patchRetry } = useBuilderStore();
  const l = config.limits;
  const r = config.retry;
  return (
    <div className="flex max-w-xl flex-col gap-4">
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
          <Label htmlFor="cap">Max cost / run (cents)</Label>
          <Input id="cap" type="number" min={1} value={l.maxCostPerRun.amountCents} aria-invalid={issues.some((i) => i.field === "maxCostPerRun")} onChange={(e) => patchLimits({ maxCostPerRun: { amountCents: Number(e.target.value), currency: "USD" } })} />
          <FieldError issues={issues} field="maxCostPerRun" />
        </div>
        <div className={fieldRow}>
          <Label htmlFor="timeout">Timeout (ms)</Label>
          <Input id="timeout" type="number" min={1000} step={1000} value={l.timeoutMs} onChange={(e) => patchLimits({ timeoutMs: Number(e.target.value) })} />
        </div>
      </div>

      <div className="rounded-md border border-border p-3">
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
        </div>
      </div>
      <SectionWarnings issues={issues} />
    </div>
  );
}

function GuardrailsSection({ issues }: { issues: Issue[] }) {
  const { config, patchGuardrails } = useBuilderStore();
  const g = config.guardrails;
  const filters: Array<{ key: "toxicity" | "secrets" | "prompt_injection"; label: string }> = [
    { key: "prompt_injection", label: "Prompt injection" },
    { key: "secrets", label: "Secret leakage" },
    { key: "toxicity", label: "Toxicity" },
  ];
  function toggleFilter(key: "toxicity" | "secrets" | "prompt_injection", on: boolean) {
    const set = new Set(g.contentFilters);
    if (on) set.add(key);
    else set.delete(key);
    patchGuardrails({ contentFilters: [...set] });
  }
  return (
    <div className="flex max-w-xl flex-col gap-4">
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
            <label key={f.key} className="flex items-center justify-between">
              <span className="text-sm">{f.label}</span>
              <Switch checked={g.contentFilters.includes(f.key)} onCheckedChange={(on) => toggleFilter(f.key, on)} />
            </label>
          ))}
        </div>
      </fieldset>

      <div className={fieldRow}>
        <Label htmlFor="egress">Egress allowlist</Label>
        <Input
          id="egress"
          value={g.egressAllowlist.join(", ")}
          onChange={(e) => patchGuardrails({ egressAllowlist: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="api.stripe.com, hooks.slack.com"
        />
        <p className="text-xs text-muted-foreground">Comma-separated domains the agent may reach.</p>
      </div>
      <SectionWarnings issues={issues} />
    </div>
  );
}

function ReviewSection({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return (
    <div className="flex max-w-xl flex-col gap-4">
      {errors.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success-surface/40 p-3 text-sm">
          <CheckCircle2 className="size-4 text-success" />
          Configuration is valid and ready to publish.
        </div>
      ) : (
        <div className="rounded-md border border-danger/30 bg-danger-surface/40 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle className="size-4" /> {errors.length} issue{errors.length > 1 ? "s" : ""} block publishing
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-foreground">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="capitalize">{e.section}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <SectionWarnings issues={warnings} />
    </div>
  );
}
