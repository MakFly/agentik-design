"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useAgentSelection } from "@/components/runtime/agent-selection";
import { AgentAvatar, isApiRuntime, runtimeFromName, useDaemonOnline } from "./agent-presence";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { hrefFor } from "@/config/nav";

/**
 * Sidebar agent switcher (replaces the old "New chat" button): the current agent +
 * dropdown to switch, with a "+" button to start a fresh conversation. Reads the shared
 * `AgentSelectionProvider`, so the chat runtime picks up the same selection.
 */
export function AgentSwitcher({ team }: { team: string }) {
  const router = useRouter();
  const { agents, agentsLoading, selectedAgentId, setSelectedAgentId } =
    useAgentSelection();
  const online = useDaemonOnline(team);
  const selected = agents.find((a) => a.id === selectedAgentId) ?? null;
  // Prefer the agent's real runtimeKind; fall back to a "(runtime)" name suffix.
  const runtime = selected ? (selected.runtimeKind ?? runtimeFromName(selected.name)) : null;
  // API runtimes are ready via the in-process gateway (no daemon); CLI/daemon runtimes need one.
  const ready = selected ? isApiRuntime(selected.runtimeKind) || online : false;

  const onNewThread = () => {
    window.dispatchEvent(new CustomEvent("agentik:new-thread"));
    router.push(hrefFor(team, "chat"));
  };

  return (
    <div className="flex items-center gap-1">
      <Select
        value={selectedAgentId ?? ""}
        onValueChange={setSelectedAgentId}
        disabled={agentsLoading || agents.length === 0}
      >
        <SelectTrigger
          aria-label="Switch agent"
          className="h-auto w-full min-w-0 flex-1 gap-2 rounded-lg border-transparent bg-transparent px-2 py-1.5 shadow-none ring-0 outline-none hover:bg-sidebar-accent/70 focus:ring-0 focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-sidebar-accent [&>svg:last-child]:hidden"
        >
          {selected ? (
            <span className="flex w-full min-w-0 items-center gap-2.5">
              <AgentAvatar name={selected.name} online={online} />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="truncate text-sm font-semibold text-foreground">
                  {selected.name}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {runtime ? `${runtime} · ` : ""}
                  {ready ? "ready" : "no runtime"}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground/60" />
            </span>
          ) : (
            <span className="px-1 text-sm text-muted-foreground">
              {agentsLoading ? "Loading agents…" : "No agents"}
            </span>
          )}
        </SelectTrigger>
        <SelectContent align="start" className="min-w-64">
          {agents.map((a) => {
            const rt = runtimeFromName(a.name);
            const isSel = a.id === selectedAgentId;
            return (
              <SelectItem
                key={a.id}
                value={a.id}
                className="py-2 [&>span:first-child]:hidden"
              >
                <span className="flex w-full items-center gap-2.5">
                  <AgentAvatar name={a.name} online={online} size="sm" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    {rt && (
                      <span className="text-[11px] text-muted-foreground">{rt}</span>
                    )}
                  </span>
                  {isSel && <Check className="ml-auto size-4 text-running" />}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <button
        type="button"
        onClick={onNewThread}
        aria-label="New conversation"
        title="New conversation"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
