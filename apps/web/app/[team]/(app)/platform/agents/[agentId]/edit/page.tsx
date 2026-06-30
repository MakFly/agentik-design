import type { Metadata } from "next";
import { AgentEditScreen } from "@/features/agent-builder/edit-screen";

export const metadata: Metadata = { title: "Edit agent" };

export default async function EditAgentPage({ params }: { params: Promise<{ team: string; agentId: string }> }) {
  const { team, agentId } = await params;
  return <AgentEditScreen team={team} agentId={agentId} />;
}
