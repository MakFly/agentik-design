import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AgentsTable, NewAgentButton } from "@/features/agent-registry/agents-table";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agents"
        description="Your agent fleet — health, versions, success rate, and cost per task."
        actions={<NewAgentButton team={team} />}
      />
      <AgentsTable team={team} />
    </div>
  );
}
