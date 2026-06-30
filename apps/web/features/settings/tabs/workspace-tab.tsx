"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useWorkspaceSettings,
  useUpdateWorkspace,
} from "@/features/configure/settings-api";
import { toastApiError } from "@/lib/api/toast-error";
import { useRbac } from "@/lib/auth/rbac";
import {
  SettingsSection,
  SettingsPanel,
  SettingsSaveBar,
} from "@/features/settings/components/settings-section";
import { refreshSession } from "@/features/settings/lib/refresh-session";

export function WorkspaceTab({ team }: { team: string }) {
  const router = useRouter();
  const { can } = useRbac();
  const { data, isLoading } = useWorkspaceSettings(team);
  const update = useUpdateWorkspace(team);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  useEffect(() => {
    if (data) {
      setName(data.name);
      setSlug(data.slug);
    }
  }, [data]);

  async function save() {
    try {
      const res = await update.mutateAsync({ name, slug });
      await refreshSession(team);
      toast.success("Workspace updated");
      if (res.slug !== team) router.replace(`/${res.slug}/platform/settings?tab=workspace`);
    } catch (e) {
      toastApiError(e, "Could not update workspace");
    }
  }

  const editable = can("settings:update");
  const dirty =
    !!data && editable && (name.trim() !== data.name || slug !== data.slug);

  return (
    <SettingsSection
      title="General"
      description="Workspace identity and URL slug."
    >
      <SettingsPanel className="p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {isLoading ? (
            <>
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="ws-name">Name</Label>
                <Input
                  id="ws-name"
                  value={name}
                  readOnly={!editable}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ws-slug">Slug</Label>
                <Input
                  id="ws-slug"
                  value={slug}
                  readOnly={!editable}
                  className="font-mono"
                  onChange={(e) =>
                    setSlug(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                    )
                  }
                />
              </div>
            </>
          )}
        </div>
        {!editable ? (
          <p className="mt-4 text-xs text-muted-foreground">
            You need settings:update to edit workspace details.
          </p>
        ) : null}
      </SettingsPanel>

      <SettingsSaveBar
        show={!!dirty}
        pending={update.isPending}
        onSave={() => void save()}
        onReset={() => {
          if (data) {
            setName(data.name);
            setSlug(data.slug);
          }
        }}
        label="Save workspace"
      />
    </SettingsSection>
  );
}
