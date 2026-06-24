import type { Metadata } from "next";
import { Base } from "@/components/examples/base";
import { DemoRuntimeProvider } from "@/components/runtime/demo-runtime-provider";
import {
  getDefaultAvailableModelId,
  getModelAvailabilityMap,
} from "@/lib/llm/availability";

export const metadata: Metadata = { title: { absolute: "Chat — Agentik" } };

export default async function TheChatPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  const modelAvailability = getModelAvailabilityMap();
  const defaultModelId = getDefaultAvailableModelId();

  return (
    <DemoRuntimeProvider>
      <Base
        team={team}
        showHeader={false}
        modelAvailability={modelAvailability}
        defaultModelId={defaultModelId}
      />
    </DemoRuntimeProvider>
  );
}
