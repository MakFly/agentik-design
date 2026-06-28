"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Settings layout primitives shared by every tab. The design goal is a flat
 * "divided rows" pattern (Linear/Vercel style) instead of nested cards:
 * one section header, one bordered panel, rows separated by hairlines.
 */

/** Section header (title + description) with an optional action slot, then content. */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Bordered container that replaces shadcn `Card` for settings surfaces. */
export function SettingsPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>
      {children}
    </div>
  );
}

/**
 * A single setting row: label + hint on the start side, control on the end.
 * Stacks vertically under 640px, aligns horizontally above. Use inside a
 * `<div className="divide-y">` to get hairline separators between rows.
 */
export function SettingRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-0.5">
        <Label
          htmlFor={htmlFor}
          className="text-sm font-medium text-foreground"
        >
          {title}
        </Label>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

/**
 * Sticky save bar pinned to the bottom of the scrollable content pane. Only
 * rendered when the form is dirty. Honors the iOS home-indicator safe area.
 */
export function SettingsSaveBar({
  show,
  pending,
  onSave,
  onReset,
  label = "Save changes",
}: {
  show: boolean;
  pending?: boolean;
  onSave: () => void;
  onReset?: () => void;
  label?: string;
}) {
  if (!show) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:-mx-6 md:px-6">
      {onReset ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={pending}
        >
          Reset
        </Button>
      ) : null}
      <Button size="sm" onClick={onSave} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {label}
      </Button>
    </div>
  );
}
