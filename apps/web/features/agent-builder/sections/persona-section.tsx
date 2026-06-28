"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PromptVariable } from "@/types/domain";
import { PromptEditor } from "../prompt-editor";
import { useBuilderStore } from "../store-context";
import { syncPromptVariables, type Issue } from "../validation";
import { fieldRow, FieldError, SectionWarnings, SectionHeading } from "./section-kit";

export function PersonaSection({ issues }: { issues: Issue[] }) {
  const identity = useBuilderStore((s) => s.identity);
  const patchIdentity = useBuilderStore((s) => s.patchIdentity);
  const config = useBuilderStore((s) => s.config);
  const setSystemPrompt = useBuilderStore((s) => s.setSystemPrompt);
  const setPromptVariables = useBuilderStore((s) => s.setPromptVariables);

  function onPromptChange(prompt: string) {
    setSystemPrompt(prompt);
    // keep declared variables in lockstep with the `{{vars}}` in the prompt
    setPromptVariables(syncPromptVariables(prompt, config.promptVariables));
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading title="Persona" hint="Who the agent is and how it thinks." />

      <div className="flex flex-col gap-4">
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
        <div className={fieldRow}>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={identity.description ?? ""}
            onChange={(e) => patchIdentity({ description: e.target.value })}
            className="min-h-16 text-sm"
            placeholder="One line teammates see in the roster (optional)."
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Label>System prompt</Label>
        <PromptEditor
          value={config.systemPrompt}
          onChange={onPromptChange}
          invalid={issues.some((i) => i.field === "systemPrompt")}
        />
        <FieldError issues={issues} field="systemPrompt" />
      </div>

      <PromptVariablesPanel />
      <SectionWarnings issues={issues} />
    </div>
  );
}

/** Edits source/required for each `{{var}}` detected in the prompt. */
function PromptVariablesPanel() {
  const vars = useBuilderStore((s) => s.config.promptVariables);
  const setPromptVariables = useBuilderStore((s) => s.setPromptVariables);

  if (vars.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No variables yet. Reference one with <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">{"{{name}}"}</code> in
        the prompt and it shows up here.
      </p>
    );
  }

  const patch = (key: string, p: Partial<PromptVariable>) =>
    setPromptVariables(vars.map((v) => (v.key === key ? { ...v, ...p } : v)));

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Prompt variables</legend>
      <ul className="mt-2 flex flex-col gap-2">
        {vars.map((v) => (
          <li key={v.key} className="flex flex-wrap items-center gap-3">
            <code className="rounded bg-surface-2 px-1.5 py-1 font-mono text-xs text-accent-foreground">{`{{${v.key}}}`}</code>
            <Select value={v.source} onValueChange={(source) => patch(v.key, { source: source as PromptVariable["source"] })}>
              <SelectTrigger className="h-9 w-36" aria-label={`Source for ${v.key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="input">Input</SelectItem>
                <SelectItem value="memory">Memory</SelectItem>
                <SelectItem value="context">Context</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex min-h-[44px] items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={v.required} onCheckedChange={(required) => patch(v.key, { required })} />
              required
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
