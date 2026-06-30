import type { ReactNode } from "react";
import { SessionHydrator } from "@/features/session/session-hydrator";
import { SessionGuard } from "@/features/session/session-guard";

/**
 * Team root layout — session only. The visual shell is chosen by the nested surface
 * layouts: `(assistant)/layout` (personal assistant) and `platform/layout` (Multica).
 */
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
      <SessionGuard team={team}>{children}</SessionGuard>
    </>
  );
}
