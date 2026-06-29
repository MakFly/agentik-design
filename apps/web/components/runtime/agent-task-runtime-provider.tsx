"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useAgents } from "@/features/agent-registry/api";

/**
 * RESERVED (Phase 4): real assistant-ui runtime that points at /api/agent-chat — a
 * bridge that runs a message as a real agent task on the daemon and streams the
 * result back (the selected agent travels in a header). The standalone /chat route
 * was removed (it violated the "no isolated lite chat" rule); this provider + the
 * /api/agent-chat bridge are kept to be embedded into the Project/Agent console.
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
