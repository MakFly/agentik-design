import type { Metadata } from "next";
import { WorkflowBuilder } from "@/features/workflow-builder/workflow-builder";

export const metadata: Metadata = { title: "New workflow" };

export default async function NewWorkflowPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <WorkflowBuilder team={team} />;
}
