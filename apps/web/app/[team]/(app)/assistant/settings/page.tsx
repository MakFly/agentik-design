import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldX } from "lucide-react";
import { RbacGate } from "@/lib/auth/rbac";
import { TeamSettingsPage } from "@/features/configure/team-settings-page";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings on the assistant surface (served from the team root, /{team}/settings). Reuses the
 * shared team settings (account, workspace, providers, connections) so the personal assistant
 * has its own settings without routing into the platform — same data, assistant shell.
 */
export default async function AssistantSettingsPage({
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
          <ShieldX className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            You don&apos;t have access to settings
          </p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Ask a workspace owner to grant the settings permission.
          </p>
        </div>
      }
    >
      <Suspense>
        <div className="mx-auto w-full max-w-4xl p-6">
          <TeamSettingsPage team={team} />
        </div>
      </Suspense>
    </RbacGate>
  );
}
