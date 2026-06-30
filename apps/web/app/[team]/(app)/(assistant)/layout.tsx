import type { ReactNode } from "react";
import { AgentSelectionProvider } from "@/components/runtime/agent-selection";
import { AssistantShell } from "@/components/layout/assistant-shell";

/**
 * Personal assistant surface (chat + memory + automations + telegram). The agent
 * selection is provided here so the sidebar switcher and the chat runtime share it.
 */
export default async function AssistantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return (
    <AgentSelectionProvider team={team}>
      <AssistantShell team={team}>{children}</AssistantShell>
    </AgentSelectionProvider>
  );
}
