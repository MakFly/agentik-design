import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RunsBoard } from "@/features/runs-board/runs-board";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team } = await params;
  const sp = await searchParams;

  if (!sp.group) {
    const q = new URLSearchParams();
    q.set("group", "status");
    if (typeof sp.scope === "string") q.set("scope", sp.scope);
    redirect(`/${team}/platform/runs?${q.toString()}`);
  }

  return (
    <div className="flex h-[calc(100dvh-var(--navbar-h)-3rem)] min-h-[520px] flex-col md:h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <RunsBoard team={team} />
    </div>
  );
}
