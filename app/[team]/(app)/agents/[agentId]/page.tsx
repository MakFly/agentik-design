import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentDetailPage({ params }: { params: Promise<{ team: string; agentId: string }> }) {
  const { team, agentId } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={agentId} back={{ href: `/${team}/agents`, label: "Agents" }} />
      <EmptyState
        icon={Bot}
        title="Agent overview"
        description="Versions, health, recent runs, and per-version metrics for this agent land in Phase 1/3."
      />
    </div>
  );
}
