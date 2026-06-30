import type { Metadata } from "next";
import { McpServersPage } from "@/features/tools/mcp-servers-page";

export const metadata: Metadata = { title: "MCP servers" };

export default async function ToolsMcpPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return <McpServersPage team={team} />;
}
