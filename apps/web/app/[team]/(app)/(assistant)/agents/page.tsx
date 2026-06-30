import type { Metadata } from "next";
import { AgentsTable } from "@/features/agent-registry/agents-table";

export const metadata: Metadata = { title: "Agents" };

/**
 * Agents (OpenClaw "Agents"): the assistant's roster — persona, runtime, tools, skills.
 * Reuses the registry table inside the assistant shell so agents are managed without
 * leaving the personal surface.
 */
export default async function AssistantAgentsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <AgentsTable team={team} />
    </div>
  );
}
