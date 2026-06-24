"use client";

import { Bot } from "lucide-react";
import { Base } from "@/components/examples/base";
import { AgentTaskRuntimeProvider, useAgentChat } from "@/components/runtime/agent-task-runtime-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * /chat screen: the immersive assistant-ui surface (reused from the demo `Base`
 * verbatim) wired to the real agent-task backend via AgentTaskRuntimeProvider,
 * with a thin agent picker on top. Kept in its own files — thechat is untouched.
 */
function AgentToolbar() {
  const { agents, agentsLoading, selectedAgentId, setSelectedAgentId } = useAgentChat();
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <Bot className="size-4 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">Agent</span>
      <Select value={selectedAgentId ?? ""} onValueChange={setSelectedAgentId} disabled={agentsLoading || agents.length === 0}>
        <SelectTrigger className="h-8 w-56">
          <SelectValue placeholder={agentsLoading ? "Loading agents…" : agents.length ? "Pick an agent" : "No agents"} />
        </SelectTrigger>
        <SelectContent>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
      <div className="flex h-full flex-col">
        <AgentToolbar />
        <div className="min-h-0 flex-1">
          <Base team={team} threadId={threadId} showHeader={false} modelAvailability={modelAvailability} defaultModelId={defaultModelId} />
        </div>
      </div>
    </AgentTaskRuntimeProvider>
  );
}
