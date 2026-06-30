import type { Metadata } from "next";
import { TraceView } from "@/features/observability/trace-view";

export const metadata: Metadata = { title: "Trace" };

export default async function TracePage({ params }: { params: Promise<{ team: string; traceId: string }> }) {
  const { team, traceId } = await params;
  return <TraceView team={team} traceId={traceId} />;
}
