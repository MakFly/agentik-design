import type { Metadata } from "next";
import { DashboardSettings } from "@/features/dashboard-settings/dashboard-settings";

export const metadata: Metadata = { title: "Settings — assistant-ui" };

export default async function DashboardSettingsPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return (
    <main className="h-dvh overflow-hidden">
      <DashboardSettings team={team} />
    </main>
  );
}
