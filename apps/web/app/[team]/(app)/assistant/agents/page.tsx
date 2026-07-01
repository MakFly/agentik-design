import type { Metadata } from "next";
import { AssistantAgentsScreen } from "@/features/assistant-agents/assistant-agents-screen";

export const metadata: Metadata = { title: "Agents" };

/**
 * Agents (assistant surface, OpenClaw model): the roster you talk to. Clicking an agent
 * selects it for the chat and stays on the assistant surface — it never routes into the
 * platform builder (which needs a runtime). Deep management lives in Multica platform.
 */
export default async function AssistantAgentsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <AssistantAgentsScreen team={team} />;
}
