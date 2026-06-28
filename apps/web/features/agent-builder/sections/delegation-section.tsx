"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Info, Network, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAgents } from "@/features/agent-registry/api";
import { useRoster, useSetRoster, type RosterInput, type Subagent } from "@/features/agent-fleet/api";
import { useBuilderStore } from "../store-context";
import { SectionHeading } from "./section-kit";

export function DelegationSection({
  team,
  mode,
  agentId,
}: {
  team: string;
  mode: "create" | "edit";
  agentId?: string;
}) {
  const isOrchestrator = useBuilderStore((s) => s.identity.isOrchestrator ?? false);
  const patchIdentity = useBuilderStore((s) => s.patchIdentity);
  const persisted = mode === "edit" && Boolean(agentId);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading
        title="Delegation"
        hint="Orchestrators route work to a roster of subagents. Mark this agent as an orchestrator, then wire who it can delegate to."
      />

      <label className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Is this an orchestrator?</span>
          <span className="text-xs text-muted-foreground">
            Orchestrators appear as parent nodes in the Fleet graph and can delegate to subagents.
          </span>
        </span>
        <Switch
          checked={isOrchestrator}
          onCheckedChange={(v) => patchIdentity({ isOrchestrator: v })}
          aria-label="Is this an orchestrator?"
        />
      </label>

      {!isOrchestrator ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Enable orchestrator to delegate work to other agents.
        </p>
      ) : !persisted ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          Publish first to wire delegation — the roster lives on a saved agent.
        </div>
      ) : (
        <RosterEditor team={team} agentId={agentId!} />
      )}

      <Button asChild variant="outline" className="w-fit">
        <Link href={`/${team}/agents/fleet`}>
          <Network className="size-4" /> Open in Fleet
        </Link>
      </Button>
    </div>
  );
}

function RosterEditor({ team, agentId }: { team: string; agentId: string }) {
  const roster = useRoster(team, agentId);
  const setRoster = useSetRoster(team, agentId);
  const subagents = useMemo(() => roster.data?.subagents ?? [], [roster.data]);

  const toInputs = (list: Subagent[]): RosterInput[] =>
    list.map((s, i) => ({ agentId: s.agentId, instruction: s.instruction, position: i }));

  function remove(id: string) {
    setRoster.mutate(toInputs(subagents.filter((s) => s.agentId !== id)), {
      onSuccess: () => toast.success("Removed from roster"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update roster"),
    });
  }

  function add(id: string, instruction: string) {
    if (subagents.some((s) => s.agentId === id)) return;
    setRoster.mutate(
      [...toInputs(subagents), { agentId: id, instruction: instruction.trim() || undefined, position: subagents.length }],
      {
        onSuccess: () => toast.success("Added to roster"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update roster"),
      },
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <Label className="text-sm font-medium">Roster</Label>
      {roster.isLoading ? (
        <Skeleton className="h-16" />
      ) : subagents.length ? (
        <ul className="flex flex-col gap-2">
          {subagents.map((s) => (
            <li key={s.agentId} className="flex items-center gap-2 rounded-md border border-border p-2">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-base"
                style={{ backgroundColor: s.color ?? "#6366f1" }}
                aria-hidden
              >
                {s.emoji ?? "🤖"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                {s.instruction ? <p className="truncate text-xs text-muted-foreground">{s.instruction}</p> : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label={`Remove ${s.name}`}
                onClick={() => remove(s.agentId)}
                disabled={setRoster.isPending}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          No subagents yet. Add one below to delegate work.
        </p>
      )}

      <AddSubagent team={team} selfId={agentId} existing={subagents.map((s) => s.agentId)} onAdd={add} busy={setRoster.isPending} />
    </section>
  );
}

function AddSubagent({
  team,
  selfId,
  existing,
  onAdd,
  busy,
}: {
  team: string;
  selfId: string;
  existing: string[];
  onAdd: (agentId: string, instruction: string) => void;
  busy: boolean;
}) {
  const agents = useAgents(team);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [instruction, setInstruction] = useState("");

  const options = useMemo(() => {
    const taken = new Set([selfId, ...existing]);
    return (agents.data?.items ?? []).filter((a) => !taken.has(a.id));
  }, [agents.data, selfId, existing]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">Add subagent</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="min-h-[44px] justify-between">
            <span className="truncate">{picked ? picked.name : "Select an agent…"}</span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder="Search agents…" />
            <CommandList>
              <CommandEmpty>{agents.isLoading ? "Loading…" : "No agents available."}</CommandEmpty>
              <CommandGroup>
                {options.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.name} ${a.id}`}
                    onSelect={() => {
                      setPicked({ id: a.id, name: a.name });
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("size-4", picked?.id === a.id ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{a.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Instruction (optional) — when to delegate here"
        className="min-h-[44px]"
      />
      <div className="flex justify-end gap-2">
        {picked ? (
          <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
            <X className="size-4" /> Clear
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!picked || busy}
          onClick={() => {
            if (!picked) return;
            onAdd(picked.id, instruction);
            setPicked(null);
            setInstruction("");
          }}
        >
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  );
}
