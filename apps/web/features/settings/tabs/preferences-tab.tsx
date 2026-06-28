"use client";

import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePreferencesStore,
  type SubmitMode,
  type ThemePreference,
} from "@/lib/stores/preferences.store";
import { useUpdateUiPreferences } from "@/features/configure/settings-api";
import { toastApiError } from "@/lib/api/toast-error";
import {
  SettingsSection,
  SettingsPanel,
  SettingRow,
} from "@/features/settings/components/settings-section";

export function PreferencesTab() {
  const { setTheme: setNextTheme } = useTheme();
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  const submitMode = usePreferencesStore((s) => s.submitMode);
  const theme = usePreferencesStore((s) => s.theme);
  const setReduceMotion = usePreferencesStore((s) => s.setReduceMotion);
  const setSubmitMode = usePreferencesStore((s) => s.setSubmitMode);
  const setThemePref = usePreferencesStore((s) => s.setTheme);
  const update = useUpdateUiPreferences();

  async function persist(patch: {
    reduceMotion?: boolean;
    submitMode?: SubmitMode;
    theme?: ThemePreference;
  }) {
    try {
      await update.mutateAsync(patch);
    } catch (e) {
      toastApiError(e, "Could not sync preferences");
    }
  }

  return (
    <SettingsSection
      title="Preferences"
      description="Interface defaults synced to your account."
    >
      <SettingsPanel className="px-5">
        <div className="divide-y divide-border">
          <SettingRow
            title="Reduce motion"
            description="Minimize animations across the app."
          >
            <Switch
              checked={reduceMotion}
              onCheckedChange={(v) => {
                setReduceMotion(v);
                void persist({ reduceMotion: v });
              }}
            />
          </SettingRow>

          <SettingRow
            title="Composer submit"
            description={
              submitMode === "enter"
                ? "Enter sends, Shift+Enter newline"
                : "Ctrl+Enter sends, Enter newline"
            }
          >
            <Switch
              checked={submitMode === "ctrlEnter"}
              onCheckedChange={(on) => {
                const mode = (on ? "ctrlEnter" : "enter") satisfies SubmitMode;
                setSubmitMode(mode);
                void persist({ submitMode: mode });
              }}
            />
          </SettingRow>

          <SettingRow
            title="Theme"
            description="Light, dark, or follow system."
          >
            <Select
              value={theme}
              onValueChange={(v) => {
                const t = v as ThemePreference;
                setThemePref(t);
                setNextTheme(t === "system" ? "system" : t);
                void persist({ theme: t });
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </SettingsPanel>
    </SettingsSection>
  );
}
