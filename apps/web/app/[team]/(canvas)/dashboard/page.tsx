import type { Metadata } from "next";
import { Base } from "@/components/examples/base";
import { DemoRuntimeProvider } from "@/components/runtime/demo-runtime-provider";
import {
  getDefaultAvailableModelId,
  getModelAvailabilityMap,
} from "@/lib/llm/availability";

export const metadata: Metadata = { title: { absolute: "Base demo — assistant-ui" } };

export default async function DashboardPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  const modelAvailability = getModelAvailabilityMap();
  const defaultModelId = getDefaultAvailableModelId();

  return (
    <main className="h-dvh overflow-hidden">
      <DemoRuntimeProvider>
        <Base
          team={team}
          modelAvailability={modelAvailability}
          defaultModelId={defaultModelId}
        />
      </DemoRuntimeProvider>
    </main>
  );
}
