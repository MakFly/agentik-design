import type { Metadata } from "next";
import { RunView } from "@/features/run-view/run-view";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ team: string; runId: string }> }) {
  const { team, runId } = await params;
  return <RunView team={team} runId={runId} />;
}
