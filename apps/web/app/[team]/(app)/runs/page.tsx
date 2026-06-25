import type { Metadata } from "next";
import { RunsBoard } from "@/features/runs-board/runs-board";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex h-[calc(100dvh-var(--navbar-h)-3rem)] min-h-[520px] flex-col md:h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <RunsBoard team={team} />
    </div>
  );
}
