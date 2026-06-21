import type { Metadata } from "next";
import { WorkflowsList } from "@/features/workflow-builder/workflows-list";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <WorkflowsList team={team} />;
}
