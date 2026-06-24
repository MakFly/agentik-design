import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AgentChat } from "@/features/agent-chat/agent-chat";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex h-[calc(100dvh-var(--navbar-h)-3rem)] min-h-[520px] flex-col gap-4 md:h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <PageHeader title="Chat" description="Talk to an agent — each message runs a real task on the daemon." />
      <AgentChat team={team} />
    </div>
  );
}
