"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { authApi } from "@/lib/auth/api";
import {
  useUpdateNotificationPreferences,
  type NotificationPreferences,
} from "@/features/configure/settings-api";
import { toastApiError } from "@/lib/api/toast-error";
import {
  SettingsSection,
  SettingsPanel,
  SettingRow,
} from "@/features/settings/components/settings-section";

const DEFAULT_NOTIFICATIONS: Required<NotificationPreferences> = {
  emailRunComplete: false,
  emailRunFailed: true,
  emailApprovalNeeded: true,
  emailInvitations: true,
  inAppRuns: true,
  inAppApprovals: true,
  inAppMentions: true,
};

const EMAIL_ROWS: {
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}[] = [
  {
    key: "emailRunComplete",
    label: "Run completed",
    hint: "Email when a run succeeds.",
  },
  { key: "emailRunFailed", label: "Run failed", hint: "Email when a run fails." },
  {
    key: "emailApprovalNeeded",
    label: "Approval needed",
    hint: "Email when a run waits for approval.",
  },
  {
    key: "emailInvitations",
    label: "Workspace invites",
    hint: "Email when you're invited to a workspace.",
  },
];

const IN_APP_ROWS: {
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
}[] = [
  {
    key: "inAppRuns",
    label: "Run activity",
    hint: "In-app toasts for run status changes.",
  },
  {
    key: "inAppApprovals",
    label: "Approvals",
    hint: "In-app alerts for pending approvals.",
  },
  {
    key: "inAppMentions",
    label: "Mentions",
    hint: "In-app when you're mentioned on a task.",
  },
];

export function NotificationsTab() {
  const [prefs, setPrefs] = useState<Required<NotificationPreferences>>(
    DEFAULT_NOTIFICATIONS,
  );
  const [loaded, setLoaded] = useState(false);
  const update = useUpdateNotificationPreferences();

  useEffect(() => {
    void authApi.me().then((me) => {
      if (me?.user.notificationPreferences) {
        setPrefs({
          ...DEFAULT_NOTIFICATIONS,
          ...me.user.notificationPreferences,
        });
      }
      setLoaded(true);
    });
  }, []);

  async function toggle(key: keyof NotificationPreferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await update.mutateAsync({ [key]: value });
    } catch (e) {
      setPrefs(prefs);
      toastApiError(e, "Could not save notification preference");
    }
  }

  function renderRows(
    rows: { key: keyof NotificationPreferences; label: string; hint: string }[],
  ) {
    return (
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <SettingRow key={row.key} title={row.label} description={row.hint}>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(v) => void toggle(row.key, v)}
              disabled={update.isPending}
            />
          </SettingRow>
        ))}
      </div>
    );
  }

  return (
    <SettingsSection
      title="Notifications"
      description="Choose how Agentik reaches you."
    >
      {!loaded ? (
        <SettingsPanel className="p-5">
          <Skeleton className="h-40 w-full" />
        </SettingsPanel>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Email
            </h3>
            <SettingsPanel className="px-5">{renderRows(EMAIL_ROWS)}</SettingsPanel>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              In-app
            </h3>
            <SettingsPanel className="px-5">
              {renderRows(IN_APP_ROWS)}
            </SettingsPanel>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
