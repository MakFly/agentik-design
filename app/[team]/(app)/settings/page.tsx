import type { Metadata } from "next";
import { ShieldX } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { RbacGate } from "@/lib/auth/rbac";
import { SettingsHub } from "@/features/settings/settings-hub";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Keys, providers, team, RBAC, billing, security, and the audit log." />
      <RbacGate
        permission="settings:read"
        fallback={
          <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <ShieldX className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">You don&apos;t have access to settings</p>
            <p className="max-w-xs text-sm text-muted-foreground">Ask a workspace owner to grant the settings permission.</p>
          </div>
        }
      >
        <SettingsHub team={team} />
      </RbacGate>
    </div>
  );
}
