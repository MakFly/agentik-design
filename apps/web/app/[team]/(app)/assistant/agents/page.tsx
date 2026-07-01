import type { Metadata } from "next";
import { AgentsTable } from "@/features/agent-registry/agents-table";

export const metadata: Metadata = { title: "Agents" };

/**
 * Agents on the assistant surface — the SAME registry table as the platform, rendered here so
 * managing/editing agents stays on the assistant. The shared components derive their base path
 * from the surface (useAgentsBase), so all agent links resolve to /{team}/assistant/agents/*.
 */
export default async function AssistantAgentsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <AgentsTable team={team} />
    </div>
  );
}
