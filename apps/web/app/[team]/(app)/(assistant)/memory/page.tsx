import type { Metadata } from "next";
import { MemoryCockpit } from "@/features/memory/memory-cockpit";

export const metadata: Metadata = { title: "Memory" };

export default async function MemoryPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <MemoryCockpit team={team} />;
}
