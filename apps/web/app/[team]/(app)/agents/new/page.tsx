import type { Metadata } from "next";
import { AgentBuilder } from "@/features/agent-builder/agent-builder";

export const metadata: Metadata = { title: "New agent" };

export default async function NewAgentPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <AgentBuilder team={team} mode="create" />;
}
