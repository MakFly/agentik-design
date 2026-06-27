"use client";

import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useRuntimeSystem } from "./api";
import { useToolCatalog } from "@/features/tools/api";
import {
  MODEL_CATALOG,
  PROVIDERS,
  findModel,
  estimateRunCents,
} from "@/config/models";
import type {
  ToolCatalogItem,
  ToolGrant,
  ToolId,
  RuntimeKind,
} from "@/types/domain";
import type { BuilderSectionKey, Issue } from "./validation";
import { issuesForSection } from "./validation";
import { formatMoney } from "@/lib/format";

function FieldError({ issues, field }: { issues: Issue[]; field?: string }) {
  const issue = issues.find((i) => i.field === field && i.severity === "error");
  if (!issue) return null;
  return (
    <p
      id={field ? `${field}-error` : undefined}
      className="text-xs text-danger"
    >
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

export function BuilderForm({
  section,
  issues,
}: {
  section: BuilderSectionKey;
  issues: Issue[];
}) {
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
        <Input
          id="name"
          value={identity.name}
          aria-invalid={issues.some((i) => i.field === "name")}
          aria-describedby="name-error"
          onChange={(e) => patchIdentity({ name: e.target.value })}
          placeholder="Support Triage Agent"
        />
        <FieldError issues={issues} field="name" />
      </div>
      <div className={fieldRow}>
        <Label htmlFor="role">Role</Label>
        <Input
          id="role"
          value={identity.role}
          aria-invalid={issues.some((i) => i.field === "role")}
          aria-describedby="role-error"
          onChange={(e) => patchIdentity({ role: e.target.value })}
          placeholder="Tier-1 support triage"
        />
        <FieldError issues={issues} field="role" />
      </div>
      <div className={fieldRow}>
        <Label htmlFor="goal">Goal</Label>
        <Input
          id="goal"
          value={identity.goal}
          onChange={(e) => patchIdentity({ goal: e.target.value })}
          placeholder="Classify & route tickets, escalate billing issues"
        />
      </div>
      <SectionWarnings issues={issues} />
    </div>
  );
}

function RuntimeField() {
  const { config, setRuntimeKind, setRuntimeBinding } = useBuilderStore();
  const { team } = useParams<{ team: string }>();
  const { data: system, isLoading } = useRuntimeSystem(team);
  const current = config.runtimeKind ?? "echo";
  const available = system?.availableRuntimes ?? [];
  const targets = system?.runnableTargets ?? [];
  // Always keep the current value selectable, even if its daemon dropped — never silently lose a choice.
  const options = [...new Set([current, ...available, ...targets.map((target) => target.runtimeKind)])];
  const currentOffline = current !== "echo" && !available.includes(current);
  const compatibleTargets = targets.filter((target) => target.runtimeKind === current);
  const daemonId = config.runtimeBinding?.daemonId ?? null;
  const selectedTarget = compatibleTargets.find((target) => target.daemonId === daemonId);
  const pinnedMissing = Boolean(daemonId && !selectedTarget);
  const reasonLabel: Record<string, string> = {
    daemon_offline: "offline",
    cli_missing: "CLI missing",
    auth_required: "sign in needed",
  };
  return (
    <div className="grid max-w-xl gap-4 sm:grid-cols-2">
      <div className={fieldRow}>
        <Label htmlFor="runtime">Runtime</Label>
        <Select
          value={current}
          onValueChange={(v) => setRuntimeKind(v as RuntimeKind)}
        >
          <SelectTrigger id="runtime">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((k) => (
              <SelectItem key={k} value={k}>
                {k}
                {k !== "echo" && !available.includes(k) ? " · offline" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {isLoading
            ? "Detecting connected daemons..."
            : available.length
              ? `Available now: ${available.join(", ")}.`
              : "No daemon online. Runs queue until a matching computer connects."}
        </p>
      </div>

      <div className={fieldRow}>
        <Label htmlFor="runtime-target">Computer</Label>
        <Select
          value={daemonId ?? "__any__"}
          onValueChange={(v) => setRuntimeBinding(v === "__any__" ? null : v)}
        >
          <SelectTrigger id="runtime-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">Any compatible computer</SelectItem>
            {compatibleTargets.map((target) => (
              <SelectItem key={`${target.daemonId}:${target.runtimeId}`} value={target.daemonId}>
                {target.daemonName ?? target.daemonId}
                {target.reason ? ` · ${reasonLabel[target.reason] ?? target.reason}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Pin the agent to one daemon when local CLI sessions or client machines matter.
        </p>
      </div>

      {currentOffline || pinnedMissing || selectedTarget?.reason ? (
        <p className="sm:col-span-2 text-xs text-warning">
          {pinnedMissing
            ? "The pinned computer no longer exposes this runtime. Pick another machine or clear the pin."
            : selectedTarget?.reason
              ? `Runs will queue until ${selectedTarget.daemonName ?? "the selected computer"} is ready (${reasonLabel[selectedTarget.reason] ?? selectedTarget.reason}).`
              : `"${current}" is not on an online daemon right now. Runs will queue until one registers it.`}
        </p>
      ) : null}
    </div>
  );
}

function ModelSection({ issues }: { issues: Issue[] }) {
  const { config, patchModel } = useBuilderStore();
  const m = config.model;
  const meta = findModel(m.model);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <RuntimeField />
      <div className={fieldRow}>
        <Label htmlFor="model">Model</Label>
        <Select
          value={m.model}
          onValueChange={(model) =>
            patchModel({
              model,
              provider: findModel(model)?.provider ?? m.provider,
            })
          }
        >
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
          <p
            className="text-xs text-muted-foreground tabular-nums"
            data-tabular
          >
            ${meta.inPerM}/M in · ${meta.outPerM}/M out · ~
            {formatMoney({
              amountCents: estimateRunCents(m.model),
              currency: "USD",
            })}
            /run est.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={fieldRow}>
          <Label htmlFor="temperature">Temperature</Label>
          <Input
            id="temperature"
            type="number"
            step="0.1"
            min={0}
            max={2}
            value={m.temperature}
            aria-invalid={issues.some((i) => i.field === "temperature")}
            onChange={(e) =>
              patchModel({ temperature: Number(e.target.value) })
            }
          />
          <FieldError issues={issues} field="temperature" />
        </div>
        <div className={fieldRow}>
          <Label htmlFor="maxTokens">Max tokens</Label>
          <Input
            id="maxTokens"
            type="number"
            min={1}
            max={meta?.maxOutput ?? 8192}
            value={m.maxTokens}
            aria-invalid={issues.some((i) => i.field === "maxTokens")}
            onChange={(e) => patchModel({ maxTokens: Number(e.target.value) })}
          />
          <FieldError issues={issues} field="maxTokens" />
        </div>
      </div>

      {meta?.reasoning ? (
        <div className={fieldRow}>
          <Label htmlFor="reasoning">Reasoning effort</Label>
          <Select
            value={m.reasoningEffort ?? "medium"}
            onValueChange={(v) =>
              patchModel({ reasoningEffort: v as "low" | "medium" | "high" })
            }
          >
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
          <span className="text-xs text-muted-foreground">
            Force structured JSON output.
          </span>
        </span>
        <Switch
          checked={m.jsonMode ?? false}
          onCheckedChange={(jsonMode) => patchModel({ jsonMode })}
        />
      </label>
    </div>
  );
}

function PromptSection({ issues }: { issues: Issue[] }) {
  const { config, setSystemPrompt } = useBuilderStore();
  return (
    <div className="flex flex-col gap-3">
      <Label>System prompt</Label>
      <PromptEditor
        value={config.systemPrompt}
        onChange={setSystemPrompt}
        invalid={issues.some((i) => i.field === "systemPrompt")}
      />
      <FieldError issues={issues} field="systemPrompt" />
    </div>
  );
}

function ToolsSection({ issues }: { issues: Issue[] }) {
  const { team } = useParams<{ team: string }>();
  const { config, setTools } = useBuilderStore();
  const { data: catalog = [], isLoading } = useToolCatalog(team);
  const selected = new Map(config.tools.map((grant) => [grant.toolId, grant]));

  const updateGrant = (toolId: ToolId, patch: Partial<ToolGrant>) => {
    setTools(
      config.tools.map((grant) =>
        grant.toolId === toolId ? { ...grant, ...patch } : grant,
      ),
    );
  };

  const toggleTool = (tool: ToolCatalogItem, checked: boolean) => {
    if (!checked) {
      setTools(config.tools.filter((grant) => grant.toolId !== tool.toolId));
      return;
    }
    if (selected.has(tool.toolId)) return;
    setTools([
      ...config.tools,
      {
        toolId: tool.toolId,
        scopes: tool.scopes.includes("read")
          ? ["read"]
          : [tool.scopes[0] ?? "read"],
      },
    ]);
  };

  const toggleScope = (grant: ToolGrant, scope: string, checked: boolean) => {
    const scopes = checked
      ? [...new Set([...grant.scopes, scope])]
      : grant.scopes.filter((item) => item !== scope);
    updateGrant(grant.toolId, { scopes: scopes.length ? scopes : ["read"] });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading tool catalog…
        </div>
      ) : catalog.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          Connect MCP servers in Tools, sync their catalog, then grant tools
          here with least-privilege scopes.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {catalog.map((tool) => {
            const grant = selected.get(tool.toolId);
            const disabled = tool.status !== "available";
            return (
              <li
                key={tool.toolId}
                className="rounded-md border border-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={!!grant}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        toggleTool(tool, checked === true)
                      }
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{tool.name}</span>
                        <Badge variant="outline">{tool.source}</Badge>
                        {tool.serverName ? (
                          <span className="text-xs text-muted-foreground">
                            {tool.serverName}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
                        {tool.description || "No description provided."}
                      </span>
                    </span>
                  </label>
                  {disabled ? (
                    <Badge variant="secondary">unavailable</Badge>
                  ) : null}
                </div>

                {grant ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                    {tool.scopes.map((scope) => (
                      <label
                        key={scope}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <Checkbox
                          checked={grant.scopes.includes(scope)}
                          onCheckedChange={(checked) =>
                            toggleScope(grant, scope, checked === true)
                          }
                        />
                        {scope}
                      </label>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleTool(tool, false)}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
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
          No memory bound. Attach a vector store to enable retrieval-augmented
          answers with citations.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {config.memory.map((mb) => (
            <li
              key={mb.storeId}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
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
          <Input
            id="rpm"
            type="number"
            min={1}
            value={l.requestsPerMin}
            onChange={(e) =>
              patchLimits({ requestsPerMin: Number(e.target.value) })
            }
          />
        </div>
        <div className={fieldRow}>
          <Label htmlFor="conc">Max concurrent runs</Label>
          <Input
            id="conc"
            type="number"
            min={1}
            value={l.maxConcurrentRuns}
            onChange={(e) =>
              patchLimits({ maxConcurrentRuns: Number(e.target.value) })
            }
          />
        </div>
        <div className={fieldRow}>
          <Label htmlFor="cap">Max cost / run (cents)</Label>
          <Input
            id="cap"
            type="number"
            min={1}
            value={l.maxCostPerRun.amountCents}
            aria-invalid={issues.some((i) => i.field === "maxCostPerRun")}
            onChange={(e) =>
              patchLimits({
                maxCostPerRun: {
                  amountCents: Number(e.target.value),
                  currency: "USD",
                },
              })
            }
          />
          <FieldError issues={issues} field="maxCostPerRun" />
        </div>
        <div className={fieldRow}>
          <Label htmlFor="timeout">Timeout (ms)</Label>
          <Input
            id="timeout"
            type="number"
            min={1000}
            step={1000}
            value={l.timeoutMs}
            onChange={(e) => patchLimits({ timeoutMs: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="rounded-md border border-border p-3">
        <h3 className="mb-3 text-sm font-medium">Retry policy</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className={fieldRow}>
            <Label htmlFor="attempts">Max attempts</Label>
            <Input
              id="attempts"
              type="number"
              min={1}
              max={10}
              value={r.maxAttempts}
              onChange={(e) =>
                patchRetry({ maxAttempts: Number(e.target.value) })
              }
            />
          </div>
          <div className={fieldRow}>
            <Label htmlFor="backoff">Backoff</Label>
            <Select
              value={r.backoff}
              onValueChange={(v) =>
                patchRetry({ backoff: v as "fixed" | "exponential" })
              }
            >
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
  const filters: Array<{
    key: "toxicity" | "secrets" | "prompt_injection";
    label: string;
  }> = [
    { key: "prompt_injection", label: "Prompt injection" },
    { key: "secrets", label: "Secret leakage" },
    { key: "toxicity", label: "Toxicity" },
  ];
  function toggleFilter(
    key: "toxicity" | "secrets" | "prompt_injection",
    on: boolean,
  ) {
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
          <span className="text-xs text-muted-foreground">
            Strip personal data before it reaches the model.
          </span>
        </span>
        <Switch
          checked={g.redactPII}
          onCheckedChange={(redactPII) => patchGuardrails({ redactPII })}
        />
      </label>

      <fieldset className="rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Content filters</legend>
        <div className="mt-2 flex flex-col gap-2">
          {filters.map((f) => (
            <label key={f.key} className="flex items-center justify-between">
              <span className="text-sm">{f.label}</span>
              <Switch
                checked={g.contentFilters.includes(f.key)}
                onCheckedChange={(on) => toggleFilter(f.key, on)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <div className={fieldRow}>
        <Label htmlFor="egress">Egress allowlist</Label>
        <Input
          id="egress"
          value={g.egressAllowlist.join(", ")}
          onChange={(e) =>
            patchGuardrails({
              egressAllowlist: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="api.stripe.com, hooks.slack.com"
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated domains the agent may reach.
        </p>
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
            <AlertTriangle className="size-4" /> {errors.length} issue
            {errors.length > 1 ? "s" : ""} block publishing
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
