import { redirect } from "next/navigation";

// Workflows is temporarily "In progress" — route disabled, feature code kept.
// The page renders <WorkflowsList> (see @/features/workflow-builder/workflows-list);
// re-enable by restoring the render below and removing this redirect.
export default async function WorkflowsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  redirect(`/${team}/command-center`);
}
