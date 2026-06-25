import type { Metadata } from "next";
import { AgentChatScreen } from "@/features/agent-chat/agent-chat-screen";
import { getDefaultAvailableModelId, getModelAvailabilityMap } from "@/lib/llm/availability";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <AgentChatScreen
      team={team}
      modelAvailability={getModelAvailabilityMap()}
      defaultModelId={getDefaultAvailableModelId()}
    />
  );
}
