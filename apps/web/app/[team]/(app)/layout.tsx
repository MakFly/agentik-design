import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

export default async function TeamLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return <AppShell team={team}>{children}</AppShell>;
}
