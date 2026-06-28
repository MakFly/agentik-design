"use client";

import { AlertTriangle } from "lucide-react";
import type { Issue } from "../validation";

export const fieldRow = "flex flex-col gap-1.5";

export function FieldError({ issues, field }: { issues: Issue[]; field?: string }) {
  const issue = issues.find((i) => i.field === field && i.severity === "error");
  if (!issue) return null;
  return (
    <p id={field ? `${field}-error` : undefined} className="text-xs text-danger">
      {issue.message}
    </p>
  );
}

export function SectionWarnings({ issues }: { issues: Issue[] }) {
  const warnings = issues.filter((i) => i.severity === "warning");
  if (!warnings.length) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning-surface/40 p-3">
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {w.message}
        </p>
      ))}
    </div>
  );
}

/** A titled block heading used at the top of each builder section. */
export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[clamp(1rem,0.9rem+0.4vw,1.15rem)] font-semibold tracking-tight">{title}</h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
