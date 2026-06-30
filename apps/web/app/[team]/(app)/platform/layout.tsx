import type { ReactNode } from "react";
import { PlatformShell } from "@/components/layout/platform-shell";

/** Multica platform surface (control-plane), served under /{team}/platform/*. */
export default async function PlatformLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return <PlatformShell team={team}>{children}</PlatformShell>;
}
