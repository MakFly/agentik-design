"use client";

import Link from "next/link";
import { PanelLeft } from "lucide-react";
import { Base, type BaseHeaderControls } from "@/components/examples/base";
import { AgentTaskRuntimeProvider } from "@/components/runtime/agent-task-runtime-provider";
import { useAgentSelection } from "@/components/runtime/agent-selection";
import { Button } from "@/components/ui/button";
import { AgentAvatar, runtimeFromName, useDaemonOnline } from "./agent-presence";

/**
 * /chat screen: the immersive assistant-ui surface (reused from `Base`) wired to the real
 * agent-task backend. The agent switcher lives in the sidebar (`AgentSwitcher`); this
 * header just shows who you're addressing (read-only presence) + a hint if no runtime.
 */

function ChatHeader({ team, controls }: { team: string; controls: BaseHeaderControls }) {
  const { agents, selectedAgentId } = useAgentSelection();
  const online = useDaemonOnline(team);
  const selected = agents.find((a) => a.id === selectedAgentId) ?? null;
  const runtime = selected ? runtimeFromName(selected.name) : null;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-2">
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

      {selected ? (
        <span className="flex items-center gap-2.5">
          <AgentAvatar name={selected.name} online={online} />
          <span className="flex flex-col items-start leading-tight">
            <span className="text-sm font-semibold text-foreground">{selected.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {runtime ? `${runtime} · ` : ""}
              {online ? "ready" : "no runtime"}
            </span>
          </span>
        </span>
      ) : null}

      {/* Only surface an actionable hint when there is NO runtime to execute the turn. */}
      {online ? null : (
        <Link
          href={`/${team}/platform/settings?section=runtimes`}
          title="No runtime online — open Settings ▸ Runtimes to connect one"
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
          No runtime — connect
        </Link>
      )}
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
        brandName="Sessions"
        modelAvailability={modelAvailability}
        defaultModelId={defaultModelId}
        headerSlot={(controls) => <ChatHeader team={team} controls={controls} />}
      />
    </AgentTaskRuntimeProvider>
  );
}
