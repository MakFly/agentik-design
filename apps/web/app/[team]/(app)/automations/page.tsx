import type { Metadata } from "next";
import { AutomationsScreen } from "@/features/automations/automations-screen";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <AutomationsScreen team={team} />
    </div>
  );
}
