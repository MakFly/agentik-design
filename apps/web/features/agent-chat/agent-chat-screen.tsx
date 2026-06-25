"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, PanelLeft } from "lucide-react";
import { Base, type BaseHeaderControls } from "@/components/examples/base";
import { AgentTaskRuntimeProvider, useAgentChat } from "@/components/runtime/agent-task-runtime-provider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * /chat screen: the immersive assistant-ui surface (reused from `Base`) wired to the
 * real agent-task backend. Base's default header is replaced with an agent-presence
 * header — who you're addressing, its runtime, and whether a daemon is live to run it.
 */

/** Runtime baked into a seeded agent name like "Sandbox (hermes)"; null otherwise. */
function runtimeFromName(name: string): string | null {
  return name.match(/\(([a-z0-9_-]+)\)\s*$/i)?.[1]?.toLowerCase() ?? null;
}

/** First glyph for the avatar — skip a leading "Sandbox" so the initial is meaningful. */
function agentInitial(name: string): string {
  const cleaned = name.replace(/^sandbox\s*/i, "").replace(/[()]/g, "").trim() || name;
  return (cleaned[0] ?? "?").toUpperCase();
}

function useDaemonOnline(team: string): boolean {
  const { data } = useQuery({
    queryKey: ["team", team, "system"],
    queryFn: ({ signal }) => apiFetch<{ daemons: { status: string }[] }>("/system", { team, signal }),
    refetchInterval: 5000,
  });
  return (data?.daemons ?? []).some((d) => d.status === "online");
}

function AgentAvatar({ name, online, size = "md" }: { name: string; online: boolean; size?: "sm" | "md" }) {
  const dim = size === "md" ? "size-9 rounded-xl text-xs" : "size-6 rounded-lg text-[10px]";
  return (
    <span className={cn("relative grid shrink-0 place-items-center bg-running/12 font-semibold text-running ring-1 ring-inset ring-running/25", dim)}>
      {agentInitial(name)}
      {size === "md" && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background",
            online ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
      )}
    </span>
  );
}

function ChatHeader({ team, controls }: { team: string; controls: BaseHeaderControls }) {
  const { agents, agentsLoading, selectedAgentId, setSelectedAgentId } = useAgentChat();
  const online = useDaemonOnline(team);
  const selected = agents.find((a) => a.id === selectedAgentId) ?? null;
  const runtime = selected ? runtimeFromName(selected.name) : null;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
      {controls.mobileMenu}
      <Button
        variant="ghost"
        size="icon"
        onClick={controls.onToggleSidebar}
        aria-label={controls.sidebarCollapsed ? "Show conversations" : "Hide conversations"}
        className="hidden size-8 text-muted-foreground md:flex"
      >
        <PanelLeft className="size-4" />
      </Button>

      <Select value={selectedAgentId ?? ""} onValueChange={setSelectedAgentId} disabled={agentsLoading || agents.length === 0}>
        <SelectTrigger
          aria-label="Switch agent"
          className="h-auto w-auto gap-2 rounded-xl border-transparent bg-transparent px-2 py-1 shadow-none ring-0 outline-none hover:bg-surface-2 focus:ring-0 focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-surface-2 [&>svg:last-child]:hidden"
        >
          {selected ? (
            <span className="flex items-center gap-2.5">
              <AgentAvatar name={selected.name} online={online} />
              <span className="flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold text-foreground">{selected.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {runtime ? `${runtime} · ` : ""}
                  {online ? "ready" : "no daemon"}
                </span>
              </span>
              <ChevronsUpDown className="ml-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
            </span>
          ) : (
            <span className="px-1 text-sm text-muted-foreground">{agentsLoading ? "Loading agents…" : "No agents"}</span>
          )}
        </SelectTrigger>
        <SelectContent align="start" className="min-w-64">
          {agents.map((a) => {
            const rt = runtimeFromName(a.name);
            const isSel = a.id === selectedAgentId;
            return (
              <SelectItem key={a.id} value={a.id} className="py-2 [&>span:first-child]:hidden">
                <span className="flex w-full items-center gap-2.5">
                  <AgentAvatar name={a.name} online={online} size="sm" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    {rt && <span className="text-[11px] text-muted-foreground">{rt}</span>}
                  </span>
                  {isSel && <Check className="ml-auto size-4 text-running" />}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <span
        className={cn(
          "ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
          online ? "border-success/30 bg-success/10 text-success" : "border-border bg-surface-2 text-muted-foreground",
        )}
      >
        <span className={cn("size-1.5 rounded-full", online ? "bg-success motion-safe:animate-pulse" : "bg-muted-foreground/50")} />
        {online ? "Daemon online" : "No daemon"}
      </span>
    </header>
  );
}

export function AgentChatScreen({
  team,
  threadId,
  modelAvailability,
  defaultModelId,
}: {
  team: string;
  threadId?: string;
  modelAvailability: Record<string, boolean>;
  defaultModelId: string;
}) {
  return (
    <AgentTaskRuntimeProvider team={team}>
      <Base
        team={team}
        threadId={threadId}
        brandName="Agentik"
        modelAvailability={modelAvailability}
        defaultModelId={defaultModelId}
        headerSlot={(controls) => <ChatHeader team={team} controls={controls} />}
      />
    </AgentTaskRuntimeProvider>
  );
}
