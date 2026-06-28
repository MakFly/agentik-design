import { redirect } from "next/navigation";

// Workflows is temporarily "In progress" — route disabled, feature code kept.
// The page renders <WorkflowBuilder> (see @/features/workflow-builder/workflow-builder);
// re-enable by restoring the render below and removing this redirect.
export default async function NewWorkflowPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  redirect(`/${team}/command-center`);
}
