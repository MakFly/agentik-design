import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SessionHydrator } from "@/features/session/session-hydrator";
import { SessionGuard } from "@/features/session/session-guard";

export default async function TeamLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return (
    <>
      <SessionHydrator team={team} />
      <SessionGuard team={team}>
        <AppShell team={team}>{children}</AppShell>
      </SessionGuard>
    </>
  );
}
