import type { Metadata } from "next";
import { AgentDetailScreen } from "@/features/agent-registry/agent-detail-screen";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentDetailPage({ params }: { params: Promise<{ team: string; agentId: string }> }) {
  const { team, agentId } = await params;
  return <AgentDetailScreen team={team} agentId={agentId} />;
}
