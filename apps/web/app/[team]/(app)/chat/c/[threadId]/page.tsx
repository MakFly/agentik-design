import type { Metadata } from "next";
import { AgentChatScreen } from "@/features/agent-chat/agent-chat-screen";
import { getDefaultAvailableModelId, getModelAvailabilityMap } from "@/lib/llm/availability";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatThreadPage({ params }: { params: Promise<{ team: string; threadId: string }> }) {
  const { team, threadId } = await params;
  return (
    <div className="h-[calc(100dvh-var(--navbar-h)-1.5rem)] min-h-[520px]">
      <AgentChatScreen
        team={team}
        threadId={threadId}
        modelAvailability={getModelAvailabilityMap()}
        defaultModelId={getDefaultAvailableModelId()}
      />
    </div>
  );
}
