import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { RunsBoard } from "@/features/runs-board/runs-board";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex h-[calc(100dvh-var(--navbar-h)-3rem)] min-h-[520px] flex-col gap-4 md:h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <PageHeader title="Runs" description="Live agent & workflow executions — drag a card to move it across lanes." />
      <RunsBoard team={team} />
    </div>
  );
}
