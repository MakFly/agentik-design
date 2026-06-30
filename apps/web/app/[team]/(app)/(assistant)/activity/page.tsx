import type { Metadata } from "next";
import { RunsBoard } from "@/features/runs-board/runs-board";

export const metadata: Metadata = { title: "Activity" };

/**
 * Activity (OpenClaw "Activité"): the assistant's recent runs — every turn that spawned
 * a task, with status and links. Reuses the platform RunsBoard inside the assistant shell.
 */
export default async function ActivityPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex h-[calc(100dvh-var(--navbar-h)-3rem)] min-h-[520px] flex-col md:h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <RunsBoard team={team} />
    </div>
  );
}
