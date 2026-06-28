import { redirect } from "next/navigation";

// Workflows is temporarily "In progress" — route disabled, feature code kept.
// The page renders <WorkflowEditor> (see @/features/workflow-builder/workflow-editor);
// re-enable by restoring the render below and removing this redirect.
export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ team: string; workflowId: string }>;
}) {
  const { team } = await params;
  redirect(`/${team}/command-center`);
}
