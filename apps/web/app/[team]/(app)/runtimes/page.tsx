import type { Metadata } from "next";
import { ShieldX } from "lucide-react";
import { RbacGate } from "@/lib/auth/rbac";
import { RuntimesPageContent } from "@/features/runtimes/runtimes-page-content";

export const metadata: Metadata = { title: "Runtimes" };

export default async function RuntimesPage({
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
            You don&apos;t have access to runtimes
          </p>
        </div>
      }
    >
      <RuntimesPageContent team={team} />
    </RbacGate>
  );
}
