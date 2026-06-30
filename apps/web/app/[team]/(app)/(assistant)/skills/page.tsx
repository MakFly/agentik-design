import type { Metadata } from "next";
import { SkillsScreen } from "@/features/skills/skills-screen";

export const metadata: Metadata = { title: "Skills" };

export default async function SkillsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <SkillsScreen team={team} />;
}
