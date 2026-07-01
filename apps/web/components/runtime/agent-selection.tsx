"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useAgents } from "@/features/agent-registry/api";

/**
 * Agent selection — shared between the assistant sidebar switcher and the chat runtime.
 * Lightweight (no assistant-ui runtime): it only resolves the agent list + the currently
 * selected agent, so the switcher can live in the sidebar (outside the chat runtime).
 */

export interface AgentOption {
  id: string;
  name: string;
  runtimeKind?: string;
}

interface AgentSelectionCtx {
  agents: AgentOption[];
  agentsLoading: boolean;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string) => void;
}

const Ctx = createContext<AgentSelectionCtx | null>(null);

export function useAgentSelection(): AgentSelectionCtx {
  const v = useContext(Ctx);
  if (!v)
    throw new Error("useAgentSelection must be used inside AgentSelectionProvider");
  return v;
}

export function AgentSelectionProvider({
  team,
  children,
}: {
  team: string;
  children: React.ReactNode;
}) {
  const agentsQ = useAgents(team);
  const agents: AgentOption[] = useMemo(
    () =>
      (agentsQ.data?.items ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        runtimeKind: (a as { runtimeKind?: string }).runtimeKind,
      })),
    [agentsQ.data],
  );
  const [selectedAgentOverride, setSelectedAgentId] = useState<string | null>(null);
  const preferredAgentId = useMemo(() => {
    // Default to a general-purpose agent (OpenClaw's "main" idea) so chat opens on an
    // assistant rather than a business specialist; fall back to hermes, then first.
    const general = agents.find((a) => /^(assistant|main)$/i.test(a.name));
    const hermes = agents.find((a) => /hermes/i.test(a.name));
    return (general ?? hermes ?? agents[0])?.id ?? null;
  }, [agents]);
  const selectedAgentId = selectedAgentOverride ?? preferredAgentId;

  return (
    <Ctx.Provider
      value={{
        agents,
        agentsLoading: agentsQ.isLoading,
        selectedAgentId,
        setSelectedAgentId,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
