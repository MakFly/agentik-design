"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSignals, useCreateRule, useUpdateRule } from "./api";
import { AgentCombobox } from "./agent-combobox";
import type { Rule, RuleActionType } from "./types";

const NO_SIGNAL = "__any__";

type ConditionRow = { path: string; equals: string };

export function RuleForm({
  team,
  open,
  onOpenChange,
  rule,
  defaultAgentId,
}: {
  team: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule?: Rule;
  defaultAgentId?: string;
}) {
  const editing = Boolean(rule);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit rule" : "New rule"}</SheetTitle>
          <SheetDescription>When a signal fires, run or orchestrate an agent.</SheetDescription>
        </SheetHeader>
        {/* Keyed + mounted-on-open so each open initializes fresh from props (no effects). */}
        {open ? (
          <RuleFields
            key={rule?.id ?? "new"}
            team={team}
            rule={rule}
            defaultAgentId={defaultAgentId}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function RuleFields({
  team,
  rule,
  defaultAgentId,
  onDone,
}: {
  team: string;
  rule?: Rule;
  defaultAgentId?: string;
  onDone: () => void;
}) {
  const signals = useSignals(team);
  const create = useCreateRule(team);
  const update = useUpdateRule(team);
  const busy = create.isPending || update.isPending;

  const [name, setName] = useState(rule?.name ?? "");
  const [signalId, setSignalId] = useState<string>(rule?.signalId ?? NO_SIGNAL);
  const [conditions, setConditions] = useState<ConditionRow[]>(rule?.condition?.all ?? []);
  const [targetAgentId, setTargetAgentId] = useState<string | undefined>(
    rule?.targetAgentId ?? defaultAgentId ?? undefined,
  );
  const [actionType, setActionType] = useState<RuleActionType>(rule?.action.type ?? "run_agent");
  const [input, setInput] = useState(rule?.action.input ?? "");
  const [active, setActive] = useState((rule?.status ?? "active") !== "disabled");

  async function submit() {
    const all = conditions.filter((c) => c.path.trim() && c.equals.trim());
    const body = {
      name: name.trim(),
      status: active ? "active" : "disabled",
      signalId: signalId === NO_SIGNAL ? null : signalId,
      condition: all.length ? { all } : null,
      action: { type: actionType, input },
      targetAgentId: targetAgentId ?? null,
    };
    try {
      if (rule) await update.mutateAsync({ id: rule.id, patch: body });
      else await create.mutateAsync(body);
      toast.success(rule ? "Rule updated" : "Rule created");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save rule");
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-name">Name</Label>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Triage new tickets" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-signal">When signal</Label>
          <Select value={signalId} onValueChange={setSignalId}>
            <SelectTrigger id="rule-signal" className="min-h-[44px] sm:min-h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SIGNAL}>Any / none</SelectItem>
              {(signals.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Conditions (optional)</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setConditions((c) => [...c, { path: "", equals: "" }])}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
          {conditions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Runs on every matching signal when empty.</p>
          ) : (
            conditions.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label="Path"
                  value={row.path}
                  onChange={(e) =>
                    setConditions((c) => c.map((r, idx) => (idx === i ? { ...r, path: e.target.value } : r)))
                  }
                  placeholder="payload.priority"
                  className="font-mono text-xs"
                />
                <span className="text-xs text-muted-foreground">=</span>
                <Input
                  aria-label="Equals"
                  value={row.equals}
                  onChange={(e) =>
                    setConditions((c) => c.map((r, idx) => (idx === i ? { ...r, equals: e.target.value } : r)))
                  }
                  placeholder="high"
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0"
                  aria-label="Remove condition"
                  onClick={() => setConditions((c) => c.filter((_, idx) => idx !== i))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-action">Then</Label>
          <Select value={actionType} onValueChange={(v) => setActionType(v as RuleActionType)}>
            <SelectTrigger id="rule-action" className="min-h-[44px] sm:min-h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="run_agent">Run agent</SelectItem>
              <SelectItem value="orchestrate">Orchestrate</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-agent">Target agent</Label>
          <AgentCombobox id="rule-agent" team={team} value={targetAgentId} onChange={setTargetAgentId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-input">Input</Label>
          <Textarea
            id="rule-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-h-24 text-sm"
            placeholder="Triage the incoming ticket: {{payload}}"
          />
        </div>

        <label className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-border px-3">
          <span className="text-sm">Enabled</span>
          <Switch checked={active} onCheckedChange={setActive} aria-label="Enabled" />
        </label>
      </div>

      <SheetFooter>
        <Button onClick={submit} disabled={busy || !name.trim()} className="min-h-[44px]">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {rule ? "Save changes" : "Create rule"}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={busy} className="min-h-[44px]">
          Cancel
        </Button>
      </SheetFooter>
    </>
  );
}
