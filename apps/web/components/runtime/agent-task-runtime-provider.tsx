"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useAgents } from "@/features/agent-registry/api";

/**
 * Real assistant-ui runtime for /chat. Uses the same AI-SDK transport shape as the
 * demo runtime (so LocalThreadHistory and the immersive UI behave identically), but
 * points at /api/agent-chat — a bridge that runs the message as a real agent task on
 * the daemon and streams the result back. The selected agent travels in a header.
 */

interface AgentOption {
  id: string;
  name: string;
}

interface AgentChatCtx {
  agents: AgentOption[];
  agentsLoading: boolean;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string) => void;
}

const Ctx = createContext<AgentChatCtx | null>(null);
export function useAgentChat(): AgentChatCtx {
  const v = useContext(Ctx);
  if (!v)
    throw new Error(
      "useAgentChat must be used inside AgentTaskRuntimeProvider",
    );
  return v;
}

export function AgentTaskRuntimeProvider({
  team,
  children,
}: {
  team: string;
  children: React.ReactNode;
}) {
  const agentsQ = useAgents(team);
  const agents: AgentOption[] = useMemo(
    () => (agentsQ.data?.items ?? []).map((a) => ({ id: a.id, name: a.name })),
    [agentsQ.data],
  );
  const [selectedAgentOverride, setSelectedAgentId] = useState<string | null>(
    null,
  );
  const preferredAgentId = useMemo(
    () =>
      (agents.find((agent) => /hermes/i.test(agent.name)) ?? agents[0])?.id ??
      null,
    [agents],
  );
  const selectedAgentId = selectedAgentOverride ?? preferredAgentId;

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/agent-chat",
      headers: () => ({ "x-agent-id": selectedAgentId ?? "", "x-team": team }),
    }),
  });

  return (
    <Ctx.Provider
      value={{
        agents,
        agentsLoading: agentsQ.isLoading,
        selectedAgentId,
        setSelectedAgentId,
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </Ctx.Provider>
  );
}
