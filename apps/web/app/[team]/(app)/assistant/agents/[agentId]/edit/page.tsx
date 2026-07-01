import type { Metadata } from "next";
import { AgentEditScreen } from "@/features/agent-builder/edit-screen";

export const metadata: Metadata = { title: "Edit agent" };

/** Edit an agent on the assistant surface (iso with the platform builder). */
export default async function AssistantEditAgentPage({
  params,
}: {
  params: Promise<{ team: string; agentId: string }>;
}) {
  const { team, agentId } = await params;
  return <AgentEditScreen team={team} agentId={agentId} />;
}
