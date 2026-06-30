"use client";

import { useTheme } from "next-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePreferencesStore, type SubmitMode } from "@/lib/stores/preferences.store";
import {
  SettingsCard,
  SettingsGroup,
  SettingsHeading,
  SettingsRow,
} from "./primitives";

/** Light/Dark/System theme picker wired to next-themes. Always controlled with a
 * "system" fallback: server and first client render agree (theme is undefined
 * until next-themes mounts), so there's no hydration mismatch. */
function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  return (
    <Select value={theme ?? "system"} onValueChange={setTheme}>
      <SelectTrigger size="sm" className="w-36" aria-label="Interface theme">
        <SelectValue placeholder="Theme" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="system">System</SelectItem>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  );
}

function SubmitModeSelect() {
  const submitMode = usePreferencesStore((s) => s.submitMode);
  const setSubmitMode = usePreferencesStore((s) => s.setSubmitMode);
  return (
    <Select value={submitMode} onValueChange={(v) => setSubmitMode(v as SubmitMode)}>
      <SelectTrigger size="sm" className="w-44" aria-label="Send message on">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="enter">Enter</SelectItem>
        <SelectItem value="ctrlEnter">⌘ + Enter</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ReduceMotionSwitch() {
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  const setReduceMotion = usePreferencesStore((s) => s.setReduceMotion);
  return (
    <Switch
      checked={reduceMotion}
      onCheckedChange={setReduceMotion}
      aria-label="Reduce motion"
    />
  );
}

export function PreferencesSection() {
  return (
    <div>
      <SettingsHeading
        title="Preferences"
        description="Customize how the assistant looks and feels for this workspace."
      />

      <SettingsGroup title="Appearance">
        <SettingsCard>
          <SettingsRow
            label="Interface theme"
            description="Select or customize your interface color scheme."
            control={<ThemeSelect />}
          />
          <SettingsRow
            label="Reduce motion"
            description="Minimize non-essential animations and transitions."
            control={<ReduceMotionSwitch />}
          />
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup title="Composer">
        <SettingsCard>
          <SettingsRow
            label="Send message on"
            description="Choose which key press sends a message in the chat."
            control={<SubmitModeSelect />}
          />
        </SettingsCard>
      </SettingsGroup>
    </div>
  );
}
