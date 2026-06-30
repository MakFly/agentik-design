import type { Metadata } from "next";
import { ObservabilityScreen } from "@/features/observability/observability-screen";

export const metadata: Metadata = { title: "Observability" };

export default async function ObservabilityPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <ObservabilityScreen team={team} />;
}
