import type { Metadata } from "next";
import { Base } from "@/components/examples/base";
import { DemoRuntimeProvider } from "@/components/runtime/demo-runtime-provider";
import {
  getDefaultAvailableModelId,
  getModelAvailabilityMap,
} from "@/lib/llm/availability";

export const metadata: Metadata = { title: { absolute: "Chat — Agentik" } };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ team: string; threadId: string }>;
}) {
  const { team, threadId } = await params;
  const modelAvailability = getModelAvailabilityMap();
  const defaultModelId = getDefaultAvailableModelId();

  return (
    <DemoRuntimeProvider>
      <Base
        team={team}
        threadId={threadId}
        showHeader={false}
        modelAvailability={modelAvailability}
        defaultModelId={defaultModelId}
      />
    </DemoRuntimeProvider>
  );
}
