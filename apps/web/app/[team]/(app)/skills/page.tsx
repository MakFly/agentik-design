import type { Metadata } from "next";
import { ShieldX } from "lucide-react";
import { RbacGate } from "@/lib/auth/rbac";
import { SkillsPage } from "@/features/configure/skills-page";

export const metadata: Metadata = { title: "Skills" };

export default async function SkillsRoute({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  return (
    <RbacGate
      permission="settings:read"
      fallback={
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center"
        >
          <ShieldX
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            You don&apos;t have access to skills
          </p>
        </div>
      }
    >
      <SkillsPage team={team} />
    </RbacGate>
  );
}
