import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Observability" };

export default async function ObservabilityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Observability" description="Traces, metrics, logs, costs, and failure analysis — the system of record." />
      <EmptyState
        icon={Activity}
        title="No telemetry in range"
        description="Once agents run, you'll get OpenTelemetry-style trace waterfalls, latency/cost metrics, a log explorer, and prompt-version attribution."
      />
    </div>
  );
}
