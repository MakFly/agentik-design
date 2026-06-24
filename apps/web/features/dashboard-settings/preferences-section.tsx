"use client";

import type { FC, ReactNode } from "react";
import { useTheme } from "next-themes";
import { CornerDownLeftIcon, PaletteIcon, SparklesIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePreferencesStore, type SubmitMode } from "@/lib/stores/preferences.store";

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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </h2>
      <ul className="divide-border divide-y rounded-xl border">{children}</ul>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  description,
  control,
}: {
  icon: FC<{ className?: string }>;
  label: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </li>
  );
}

export function PreferencesSection() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Preferences</h1>
        <p className="text-muted-foreground text-sm">
          Customize how the assistant looks and feels for this workspace.
        </p>
      </header>

      <Group title="Appearance">
        <Row
          icon={PaletteIcon}
          label="Interface theme"
          description="Select or customize your interface color scheme."
          control={<ThemeSelect />}
        />
        <Row
          icon={SparklesIcon}
          label="Reduce motion"
          description="Minimize non-essential animations and transitions."
          control={<ReduceMotionSwitch />}
        />
      </Group>

      <Group title="Composer">
        <Row
          icon={CornerDownLeftIcon}
          label="Send message on"
          description="Choose which key press sends a message in the chat."
          control={<SubmitModeSelect />}
        />
      </Group>
    </section>
  );
}
