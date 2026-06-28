"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { useCreateSignal, useUpdateSignal } from "./api";
import type { Signal } from "./types";

const KINDS = ["webhook", "schedule", "event", "manual"];

export function SignalForm({
  team,
  open,
  onOpenChange,
  signal,
}: {
  team: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  signal?: Signal;
}) {
  const editing = Boolean(signal);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit signal" : "New signal"}</SheetTitle>
          <SheetDescription>
            A signal is an external trigger. Rules listen to signals and run or orchestrate agents.
          </SheetDescription>
        </SheetHeader>
        {/* Keyed + mounted-on-open so each open initializes fresh from props (no effects). */}
        {open ? <SignalFields key={signal?.id ?? "new"} team={team} signal={signal} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function SignalFields({ team, signal, onDone }: { team: string; signal?: Signal; onDone: () => void }) {
  const create = useCreateSignal(team);
  const update = useUpdateSignal(team);
  const busy = create.isPending || update.isPending;

  const [name, setName] = useState(signal?.name ?? "");
  const [kind, setKind] = useState<string>(signal?.kind ?? "webhook");
  const [source, setSource] = useState(signal?.source ?? "");
  const [active, setActive] = useState((signal?.status ?? "active") !== "disabled");
  const [config, setConfig] = useState(signal?.config ? JSON.stringify(signal.config, null, 2) : "");
  const [configError, setConfigError] = useState<string | null>(null);

  async function submit() {
    let parsedConfig: Record<string, unknown> | null = null;
    if (config.trim()) {
      try {
        parsedConfig = JSON.parse(config) as Record<string, unknown>;
      } catch {
        setConfigError("Config must be valid JSON.");
        return;
      }
    }
    const body = {
      name: name.trim(),
      kind,
      source: source.trim() || undefined,
      status: active ? "active" : "disabled",
      config: parsedConfig,
    };
    try {
      if (signal) await update.mutateAsync({ id: signal.id, patch: body });
      else await create.mutateAsync(body);
      toast.success(signal ? "Signal updated" : "Signal created");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save signal");
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signal-name">Name</Label>
          <Input id="signal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New ticket created" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signal-kind">Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger id="signal-kind" className="min-h-[44px] sm:min-h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k} className="capitalize">
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signal-source">Source (optional)</Label>
          <Input id="signal-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="zendesk" />
        </div>

        <label className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-border px-3">
          <span className="text-sm">Active</span>
          <Switch checked={active} onCheckedChange={setActive} aria-label="Active" />
        </label>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signal-config">Config (JSON, optional)</Label>
          <Textarea
            id="signal-config"
            value={config}
            onChange={(e) => {
              setConfig(e.target.value);
              setConfigError(null);
            }}
            className="min-h-28 font-mono text-xs"
            placeholder='{ "secret": "..." }'
          />
          {configError ? <p className="text-xs text-danger">{configError}</p> : null}
        </div>
      </div>

      <SheetFooter>
        <Button onClick={submit} disabled={busy || !name.trim()} className="min-h-[44px]">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {signal ? "Save changes" : "Create signal"}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={busy} className="min-h-[44px]">
          Cancel
        </Button>
      </SheetFooter>
    </>
  );
}
