import type { Metadata } from "next";
import { CommandCenterScreen } from "@/features/command-center/command-center-screen";

export const metadata: Metadata = { title: "Command Center" };

export default async function CommandCenterPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return <CommandCenterScreen team={team} />;
}
