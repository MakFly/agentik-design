import type { Metadata } from "next";
import { FleetScreen } from "@/features/agent-fleet/fleet-screen";

export const metadata: Metadata = { title: "Fleet" };

export default async function FleetPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <FleetScreen team={team} />
    </div>
  );
}
