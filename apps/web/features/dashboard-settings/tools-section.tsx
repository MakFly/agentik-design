"use client";

import { useEffect, useState } from "react";
import { GlobeIcon, PlusIcon, Trash2Icon, WrenchIcon } from "lucide-react";
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

const STORAGE_KEY = "aui:dashboard:enabled-tools";

/** Persisted per-tool enabled state (defaults to enabled when unset). */
function useEnabledTools() {
  const [disabled, setDisabled] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDisabled(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
    setReady(true);
  }, []);

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
  const [custom, setCustom] = useState<CustomTool[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setCustom(readCustomTools());
  }, []);

  const persist = (next: CustomTool[]) => {
    setCustom(next);
    writeCustomTools(next);
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Tools</h1>
        <p className="text-muted-foreground text-sm">
          Tools the assistant can call during a conversation. Toggle a built-in off
          to keep it out of the model&apos;s reach, or add your own HTTP tools.
        </p>
      </header>

      {/* Built-in tools */}
      <div className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Built-in
        </h2>
        <ul className="divide-border divide-y rounded-xl border">
          {BUILTIN_TOOLS.map((t) => {
            const id = `tool-${t.name}`;
            return (
              <li key={t.name} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
                <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <WrenchIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={id} className="cursor-pointer font-medium">
                      {t.label}
                    </Label>
                    <code className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
                      {t.name}
                    </code>
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate text-sm">
                    {t.description}
                  </p>
                </div>
                <Switch
                  id={id}
                  checked={ready ? isEnabled(t.name) : true}
                  onCheckedChange={(v) => setEnabled(t.name, v)}
                  aria-label={`Enable ${t.label}`}
                />
              </li>
            );
          })}
        </ul>
      </div>

      {/* Custom HTTP tools */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Custom
          </h2>
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" /> New tool
          </Button>
        </div>

        {custom.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            No custom tools yet. Add an HTTP endpoint the assistant can call.
          </div>
        ) : (
          <ul className="divide-border divide-y rounded-xl border">
            {custom.map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
                <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <GlobeIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {t.method}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate text-sm">
                    {t.description}
                  </p>
                  <p className="text-muted-foreground/70 mt-0.5 truncate text-xs">
                    {t.url}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => persist(custom.filter((c) => c.id !== t.id))}
                  aria-label={`Delete ${t.name}`}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
        Custom tools run in your browser (public, CORS-enabled APIs; any auth header
        is client-side). Server-side execution with stored secrets is the next tier.
        Using tools via <code className="bg-muted rounded px-1 py-0.5">@</code> in the
        composer comes next too.
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
    </section>
  );
}
