import type { Metadata } from "next";
import { AgentDetailScreen } from "@/features/agent-registry/agent-detail-screen";

export const metadata: Metadata = { title: "Agent" };

/** Agent detail on the assistant surface (iso with the platform detail). */
export default async function AssistantAgentDetailPage({
  params,
}: {
  params: Promise<{ team: string; agentId: string }>;
}) {
  const { team, agentId } = await params;
  return <AgentDetailScreen team={team} agentId={agentId} />;
}
