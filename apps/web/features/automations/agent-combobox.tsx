"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** Combobox over the team's agents. `value`/`onChange` carry the agentId. */
export function AgentCombobox({
  team,
  value,
  onChange,
  placeholder = "Select an agent…",
  id,
}: {
  team: string;
  value?: string | null;
  onChange: (agentId: string | undefined) => void;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const agents = useAgents(team);
  const items = agents.data?.items ?? [];
  const selected = items.find((a) => a.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-h-[44px] w-full justify-between font-normal sm:min-h-9"
        >
          <span className={cn("flex min-w-0 items-center gap-2", !selected && "text-muted-foreground")}>
            {selected ? (
              <>
                <AgentEmoji emoji={selected.emoji} />
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search agents…" />
          <CommandList>
            <CommandEmpty>{agents.isLoading ? "Loading…" : "No agents found."}</CommandEmpty>
            <CommandGroup>
              {items.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.name} ${agent.id}`}
                  onSelect={() => {
                    onChange(agent.id === value ? undefined : agent.id);
                    setOpen(false);
                  }}
                >
                  <AgentEmoji emoji={agent.emoji} />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  {agent.role ? <span className="truncate text-xs text-muted-foreground">{agent.role}</span> : null}
                  <Check className={cn("ml-auto size-4", agent.id === value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AgentEmoji({ emoji }: { emoji?: string }) {
  return <span aria-hidden className="text-base leading-none">{emoji ?? "🤖"}</span>;
}
