import type { Metadata } from "next";
import { ProjectDetailScreen } from "@/features/projects/project-detail-screen";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ team: string; projectId: string }>;
}) {
  const { team, projectId } = await params;
  return <ProjectDetailScreen team={team} projectId={projectId} />;
}
