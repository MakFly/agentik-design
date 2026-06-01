import type { Metadata } from "next";
import { Play } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Runs" description="Every execution — live and historical — filterable by status, env, and subject." />
      <EmptyState
        icon={Play}
        title="No runs to show"
        description="Run an agent or workflow and its execution will appear here, with full timeline, reasoning, tool calls, and cost."
      />
    </div>
  );
}
