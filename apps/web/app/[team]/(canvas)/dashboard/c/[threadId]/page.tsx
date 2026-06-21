import type { Metadata } from "next";
import { Base } from "@/components/examples/base";
import { DemoRuntimeProvider } from "@/components/runtime/demo-runtime-provider";
import {
  getDefaultAvailableModelId,
  getModelAvailabilityMap,
} from "@/lib/llm/availability";

export const metadata: Metadata = { title: { absolute: "Base demo — assistant-ui" } };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ team: string; threadId: string }>;
}) {
  const { team, threadId } = await params;
  const modelAvailability = getModelAvailabilityMap();
  const defaultModelId = getDefaultAvailableModelId();

  return (
    <main className="h-dvh overflow-hidden">
      <DemoRuntimeProvider>
        <Base
          team={team}
          threadId={threadId}
          modelAvailability={modelAvailability}
          defaultModelId={defaultModelId}
        />
      </DemoRuntimeProvider>
    </main>
  );
}
