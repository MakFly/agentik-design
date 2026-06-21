"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, GaugeIcon } from "lucide-react";
import { useAui } from "@assistant-ui/react";
import {
  ModelSelector,
  resolveModelEffort,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LLM_MODELS,
  type EffortLevel,
  type ProviderId,
} from "@/lib/llm/registry";
import { cn } from "@/lib/utils";

const iconBaseUrl = "https://www.assistant-ui.com/icons";

const providerIcon: Record<ProviderId, { name: string; icon: string }> = {
  openai: { name: "OpenAI", icon: "openai.svg" },
  anthropic: { name: "Anthropic", icon: "anthropic.svg" },
  google: { name: "Google", icon: "google.svg" },
  xai: { name: "xAI", icon: "xai.svg" },
  groq: { name: "Groq", icon: "groq.svg" },
};

function ProviderIcon({ provider }: { provider: ProviderId }) {
  const { name, icon } = providerIcon[provider];
  return <img className="size-4 shrink-0" src={`${iconBaseUrl}/${icon}`} alt={name} />;
}

/**
 * Build the selector's options from the registry, disabling any model whose
 * provider has no API key. `availability` is computed server-side and passed in,
 * so the list renders correct on first paint with no client fetch.
 */
export function buildModelOptions(
  availability: Record<string, boolean>,
): ModelOption[] {
  return LLM_MODELS.map((model) => {
    const available = availability[model.id] ?? false;
    return {
      id: model.id,
      name: model.label,
      icon: <ProviderIcon provider={model.provider} />,
      disabled: !available,
      description: available ? undefined : "API key required",
      keywords: [model.provider],
      efforts: model.efforts,
    };
  });
}

const effortsById = new Map<string, readonly EffortLevel[]>(
  LLM_MODELS.filter((m) => m.efforts?.length).map((m) => [m.id, m.efforts!]),
);

/** Sentinel Select value for "no reasoning effort" (Radix needs a non-empty
 * string; effort `undefined` maps to this and back). */
const EFFORT_OFF = "off";

/** One model row: icon, name, optional right-aligned note, and a check when
 * selected. No per-row effort UI — effort lives in its own composer select. */
function ModelRow({
  option,
  selected,
}: {
  option: ModelOption;
  selected: boolean;
}) {
  return (
    <ModelSelector.Item model={option} className="pe-3">
      {option.icon}
      <span className="min-w-0 flex-1 truncate">{option.name}</span>
      {option.description && (
        <span className="text-muted-foreground shrink-0 text-xs">
          {option.description}
        </span>
      )}
      {selected && <CheckIcon className="ms-1 size-4 shrink-0" />}
    </ModelSelector.Item>
  );
}

/**
 * Standalone reasoning-effort select for the composer. Shown only when the
 * chosen model supports effort. "Off" sends no `reasoningEffort` (provider
 * default). Click/tap/keyboard — no hover, so it can't be missed or mis-aimed.
 */
function EffortSelect({
  efforts,
  value,
  onChange,
  className,
}: {
  efforts: readonly EffortLevel[];
  value: string | undefined;
  onChange: (effort: string | undefined) => void;
  className?: string;
}) {
  return (
    <Select
      value={value ?? EFFORT_OFF}
      onValueChange={(v) => onChange(v === EFFORT_OFF ? undefined : v)}
    >
      <SelectTrigger
        size="sm"
        aria-label="Reasoning effort"
        className={cn(
          "gap-1.5 border-0 bg-transparent px-2.5 text-xs shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-0 dark:bg-transparent dark:hover:bg-accent",
          className,
        )}
      >
        <GaugeIcon className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={EFFORT_OFF}>Off</SelectItem>
        {efforts.map((level) => (
          <SelectItem key={level.id} value={level.id}>
            {level.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Composer model + effort controls. Holds the selected model and effort, renders
 * the model dropdown plus an adjacent effort select (only when the model supports
 * it), and registers both into assistant-ui's model context so they reach the
 * server — replicating what the built-in `<ModelSelector>` does internally, since
 * its registrar isn't exported.
 */
export function ModelPickerSelect({
  models,
  defaultModelId,
  triggerClassName,
}: {
  models: ModelOption[];
  defaultModelId: string;
  triggerClassName?: string;
}) {
  const aui = useAui();
  const [value, setValue] = useState(defaultModelId);
  const [effort, setEffort] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);

  // Effort resolved against the current model's supported levels (a sticky
  // effort from a previous model is dropped if this one doesn't offer it).
  const activeEffort = useMemo(
    () => resolveModelEffort(models, value, effort),
    [models, value, effort],
  );
  const efforts = effortsById.get(value);

  useEffect(() => {
    if (!value) return;
    const config = {
      config: {
        modelName: value,
        ...(activeEffort !== undefined
          ? { reasoningEffort: activeEffort }
          : undefined),
      },
    };
    return aui.modelContext().register({ getModelContext: () => config });
  }, [activeEffort, aui, value]);

  return (
    <>
      <ModelSelector.Root
        models={models}
        value={value}
        onValueChange={setValue}
        open={open}
        onOpenChange={setOpen}
      >
        <ModelSelector.Trigger variant="ghost" size="sm" className={triggerClassName} />
        <ModelSelector.Content>
          <ModelSelector.List>
            <ModelSelector.Group>
              {models.map((option) => (
                <ModelRow
                  key={option.id}
                  option={option}
                  selected={option.id === value}
                />
              ))}
            </ModelSelector.Group>
          </ModelSelector.List>
        </ModelSelector.Content>
      </ModelSelector.Root>

      {efforts?.length ? (
        <EffortSelect
          efforts={efforts}
          value={activeEffort}
          onChange={setEffort}
          className={triggerClassName}
        />
      ) : null}
    </>
  );
}
