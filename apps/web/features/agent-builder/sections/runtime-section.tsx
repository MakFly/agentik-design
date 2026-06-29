"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { MODEL_CATALOG, PROVIDERS, findModel, estimateRunCents } from "@/config/models";
import type { RuntimeKind } from "@/types/domain";
import { formatMoney } from "@/lib/format";
import { useBuilderStore } from "../store-context";
import { useRuntimeSystem } from "../api";
import type { Issue } from "../validation";
import { fieldRow, FieldError, SectionHeading } from "./section-kit";

function RuntimeField() {
  const config = useBuilderStore((s) => s.config);
  const setRuntimeKind = useBuilderStore((s) => s.setRuntimeKind);
  const setRuntimeBinding = useBuilderStore((s) => s.setRuntimeBinding);
  const { team } = useParams<{ team: string }>();
  const { data: system, isLoading } = useRuntimeSystem(team);
  const current = config.runtimeKind ?? "claude";
  const available = system?.availableRuntimes ?? [];
  const targets = system?.runnableTargets ?? [];
  const options = [...new Set([current, ...available, ...targets.map((target) => target.runtimeKind)])];
  const currentOffline = !available.includes(current);
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
        <Select value={current} onValueChange={(v) => setRuntimeKind(v as RuntimeKind)}>
          <SelectTrigger id="runtime">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((k) => (
              <SelectItem key={k} value={k}>
                {k}
                {!available.includes(k) ? " · offline" : ""}
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
        <Select value={daemonId ?? "__any__"} onValueChange={(v) => setRuntimeBinding(v === "__any__" ? null : v)}>
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

export function RuntimeSection({ issues }: { issues: Issue[] }) {
  const config = useBuilderStore((s) => s.config);
  const patchModel = useBuilderStore((s) => s.patchModel);
  const m = config.model;
  const meta = findModel(m.model);
  const [schemaText, setSchemaText] = useState(() => (m.outputSchema ? JSON.stringify(m.outputSchema, null, 2) : ""));
  const [schemaError, setSchemaError] = useState<string | null>(null);

  function onSchemaChange(text: string) {
    setSchemaText(text);
    if (!text.trim()) {
      setSchemaError(null);
      patchModel({ outputSchema: undefined });
      return;
    }
    try {
      patchModel({ outputSchema: JSON.parse(text) });
      setSchemaError(null);
    } catch {
      setSchemaError("Invalid JSON — not saved.");
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading title="Model & Execution" hint="Where it runs and which model drives it. Models are hot-swappable." />
      <RuntimeField />

      <div className={fieldRow}>
        <Label htmlFor="model">Model</Label>
        <Select
          value={m.model}
          onValueChange={(model) => patchModel({ model, provider: findModel(model)?.provider ?? m.provider })}
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
          <p className="text-xs text-muted-foreground tabular-nums" data-tabular>
            ${meta.inPerM}/M in · ${meta.outPerM}/M out · ~
            {formatMoney({ amountCents: estimateRunCents(m.model), currency: "USD" })}/run est.
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
            onChange={(e) => patchModel({ temperature: Number(e.target.value) })}
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
        <div className={fieldRow}>
          <Label htmlFor="topP">Top P</Label>
          <Input
            id="topP"
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={m.topP ?? 1}
            onChange={(e) => patchModel({ topP: Number(e.target.value) })}
          />
        </div>
        {meta?.reasoning ? (
          <div className={fieldRow}>
            <Label htmlFor="reasoning">Reasoning effort</Label>
            <Select value={m.reasoningEffort ?? "medium"} onValueChange={(v) => patchModel({ reasoningEffort: v as "low" | "medium" | "high" })}>
              <SelectTrigger id="reasoning">
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
      </div>

      <div className={fieldRow}>
        <Label htmlFor="stop">Stop sequences</Label>
        <Input
          id="stop"
          value={(m.stopSequences ?? []).join(", ")}
          onChange={(e) =>
            patchModel({
              stopSequences: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder="```, END, \n\nUser:"
        />
        <p className="text-xs text-muted-foreground">Comma-separated strings that halt generation.</p>
      </div>

      <label className="flex items-center justify-between rounded-md border border-border p-3">
        <span className="flex flex-col">
          <span className="text-sm font-medium">JSON mode</span>
          <span className="text-xs text-muted-foreground">Force structured JSON output.</span>
        </span>
        <Switch checked={m.jsonMode ?? false} onCheckedChange={(jsonMode) => patchModel({ jsonMode })} />
      </label>

      {m.jsonMode ? (
        <div className={fieldRow}>
          <Label htmlFor="outputSchema">Output schema (JSON Schema)</Label>
          <Textarea
            id="outputSchema"
            value={schemaText}
            onChange={(e) => onSchemaChange(e.target.value)}
            className="min-h-32 resize-y font-mono text-[12px]"
            spellCheck={false}
            placeholder={'{\n  "type": "object",\n  "properties": { }\n}'}
            aria-invalid={Boolean(schemaError)}
          />
          {schemaError ? <p className="text-xs text-danger">{schemaError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
