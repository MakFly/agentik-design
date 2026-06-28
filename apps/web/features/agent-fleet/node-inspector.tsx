"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, ExternalLink, Loader2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAgents } from "@/features/agent-registry/api";
import { useUpdateAgent } from "@/features/agent-builder/api";
import type { AgentId } from "@/types/domain";
import { FleetAvatar } from "./agent-node";
import { useRoster, useSetRoster, type FleetNode, type RosterInput, type Subagent } from "./api";

export function NodeInspector({
  team,
  nodeId,
  node,
  open,
  onOpenChange,
}: {
  team: string;
  nodeId: string | null;
  node: FleetNode | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {node && nodeId ? <InspectorBody team={team} nodeId={nodeId} node={node} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function InspectorBody({ team, nodeId, node }: { team: string; nodeId: string; node: FleetNode }) {
  const roster = useRoster(team, nodeId, node.isOrchestrator);
  const setRoster = useSetRoster(team, nodeId);
  const updateAgent = useUpdateAgent(team);

  const subagents = useMemo(() => roster.data?.subagents ?? [], [roster.data]);

  const toInputs = (list: Subagent[]): RosterInput[] =>
    list.map((s, i) => ({ agentId: s.agentId, instruction: s.instruction, position: i }));

  function remove(agentId: string) {
    const next = toInputs(subagents.filter((s) => s.agentId !== agentId));
    setRoster.mutate(next, {
      onSuccess: () => toast.success("Removed from roster"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update roster"),
    });
  }

  function add(agentId: string, instruction: string) {
    if (subagents.some((s) => s.agentId === agentId)) return;
    const next: RosterInput[] = [
      ...toInputs(subagents),
      { agentId, instruction: instruction.trim() || undefined, position: subagents.length },
    ];
    setRoster.mutate(next, {
      onSuccess: () => toast.success("Added to roster"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update roster"),
    });
  }

  function toggleOrchestrator() {
    updateAgent.mutate(
      { agentId: nodeId as AgentId, patch: { isOrchestrator: !node.isOrchestrator } },
      {
        onSuccess: () =>
          toast.success(node.isOrchestrator ? "No longer an orchestrator" : "Marked as orchestrator"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update agent"),
      },
    );
  }

  return (
    <>
      <SheetHeader className="border-b border-border">
        <div className="flex items-center gap-3">
          <FleetAvatar emoji={node.emoji} color={node.color} />
          <div className="min-w-0">
            <SheetTitle className="truncate">{node.name}</SheetTitle>
            <SheetDescription className="truncate">{node.role || "No role set"}</SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/${team}/agents/${nodeId}/edit`}>
              <ExternalLink className="size-4" /> Open in builder
            </Link>
          </Button>
          <Button size="sm" variant={node.isOrchestrator ? "outline" : "default"} onClick={toggleOrchestrator} disabled={updateAgent.isPending}>
            {updateAgent.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {node.isOrchestrator ? "Unmark orchestrator" : "Mark as orchestrator"}
          </Button>
        </div>

        {node.isOrchestrator ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">Roster</h3>
            {roster.isLoading ? (
              <Skeleton className="h-16" />
            ) : subagents.length ? (
              <ul className="flex flex-col gap-2">
                {subagents.map((s) => (
                  <li key={s.agentId} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <FleetAvatar emoji={s.emoji} color={s.color} size="sm" />
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

            <AddSubagent team={team} selfId={nodeId} existing={subagents.map((s) => s.agentId)} onAdd={add} busy={setRoster.isPending} />
          </section>
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            Mark this agent as an orchestrator to give it a roster of subagents.
          </p>
        )}
      </div>
    </>
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
