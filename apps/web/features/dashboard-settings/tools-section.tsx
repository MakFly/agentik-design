"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BUILTIN_TOOLS } from "@/lib/tools/catalog";
import {
  readCustomTools,
  writeCustomTools,
  type CustomTool,
} from "@/lib/tools/custom-tools";
import { CustomToolDialog } from "./custom-tool-dialog";
import {
  SettingsCard,
  SettingsGroup,
  SettingsHeading,
  SettingsRow,
} from "./primitives";

const STORAGE_KEY = "aui:dashboard:enabled-tools";

/** Persisted per-tool enabled state (defaults to enabled when unset). */
function useEnabledTools() {
  const [disabled, setDisabled] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [ready] = useState(() => typeof window !== "undefined");

  const isEnabled = (name: string) => !disabled[name];
  const setEnabled = (name: string, enabled: boolean) => {
    setDisabled((prev) => {
      const next = { ...prev };
      if (enabled) delete next[name];
      else next[name] = true;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { isEnabled, setEnabled, ready };
}

export function ToolsSection() {
  const { isEnabled, setEnabled, ready } = useEnabledTools();
  const [custom, setCustom] = useState<CustomTool[]>(() =>
    typeof window === "undefined" ? [] : readCustomTools(),
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const persist = (next: CustomTool[]) => {
    setCustom(next);
    writeCustomTools(next);
  };

  return (
    <div>
      <SettingsHeading
        title="Tools"
        description="Tools the assistant can call during a conversation. Toggle a built-in off to keep it out of the model's reach, or add your own HTTP tools."
      />

      <SettingsGroup title="Built-in">
        <SettingsCard>
          {BUILTIN_TOOLS.map((t) => {
            const id = `tool-${t.name}`;
            return (
              <SettingsRow
                key={t.name}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={id} className="cursor-pointer font-medium">
                      {t.label}
                    </Label>
                    <code className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
                      {t.name}
                    </code>
                  </span>
                }
                description={t.description}
                control={
                  <Switch
                    id={id}
                    checked={ready ? isEnabled(t.name) : true}
                    onCheckedChange={(v) => setEnabled(t.name, v)}
                    aria-label={`Enable ${t.label}`}
                  />
                }
              />
            );
          })}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup
        title="Custom"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialogOpen(true)}
          >
            <PlusIcon className="size-4" /> New tool
          </Button>
        }
      >
        {custom.length === 0 ? (
          <div className="text-muted-foreground bg-card rounded-xl border border-dashed p-6 text-center text-sm">
            No custom tools yet. Add an HTTP endpoint the assistant can call.
          </div>
        ) : (
          <SettingsCard>
            {custom.map((t) => (
              <SettingsRow
                key={t.id}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    {t.name}
                    <Badge variant="outline" className="font-mono text-xs">
                      {t.method}
                    </Badge>
                  </span>
                }
                description={t.description}
                control={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() =>
                      persist(custom.filter((c) => c.id !== t.id))
                    }
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                }
              >
                <p className="text-muted-foreground/70 mt-0.5 truncate text-xs">
                  {t.url}
                </p>
              </SettingsRow>
            ))}
          </SettingsCard>
        )}
      </SettingsGroup>

      <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
        Custom tools run in your browser (public, CORS-enabled APIs; any auth
        header is client-side). Server-side execution with stored secrets is the
        next tier. Using tools via{" "}
        <code className="bg-muted rounded px-1 py-0.5">@</code> in the composer
        comes next too.
      </p>

      <CustomToolDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existingNames={[
          ...BUILTIN_TOOLS.map((t) => t.name),
          ...custom.map((t) => t.name),
        ]}
        onSave={(tool) => persist([...custom, tool])}
      />
    </div>
  );
}
