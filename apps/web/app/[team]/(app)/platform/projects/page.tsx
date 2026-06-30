import type { Metadata } from "next";
import { ProjectsScreen } from "@/features/projects/projects-screen";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <ProjectsScreen team={team} />;
}
