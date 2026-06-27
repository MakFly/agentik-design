import type { Metadata } from "next";
import { ToolsPageContent } from "@/features/tools/tools-page-content";

export const metadata: Metadata = { title: "Tools" };

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return <ToolsPageContent team={team} />;
}
