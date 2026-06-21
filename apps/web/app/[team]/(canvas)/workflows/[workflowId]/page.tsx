import type { Metadata } from "next";
import { WorkflowEditor } from "@/features/workflow-builder/workflow-editor";

export const metadata: Metadata = { title: "Edit workflow" };

export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ team: string; workflowId: string }>;
}) {
  const { team, workflowId } = await params;
  return <WorkflowEditor team={team} workflowId={workflowId} />;
}
