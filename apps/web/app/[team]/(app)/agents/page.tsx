import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AgentsTable, NewAgentButton } from "@/features/agent-registry/agents-table";
import { TemplatesButton } from "@/features/agent-registry/agent-templates-dialog";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agents"
        description="Your agent fleet — health, versions, success rate, and cost per task."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TemplatesButton team={team} />
            <NewAgentButton team={team} />
          </div>
        }
      />
      <AgentsTable team={team} />
    </div>
  );
}
