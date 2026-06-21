import type { Metadata } from "next";
import { Base } from "@/components/examples/base";
import { DemoRuntimeProvider } from "@/components/runtime/demo-runtime-provider";

export const metadata: Metadata = { title: { absolute: "Base demo — assistant-ui" } };

export default function DashboardPage() {
  return (
    <main className="h-dvh overflow-hidden">
      <DemoRuntimeProvider>
        <Base />
      </DemoRuntimeProvider>
    </main>
  );
}
