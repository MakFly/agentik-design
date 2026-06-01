"use client";

import { AlertCircle } from "lucide-react";
import type { BuilderSectionKey, Issue } from "./validation";
import { issuesForSection } from "./validation";
import { cn } from "@/lib/utils";

export const SECTIONS: Array<{ key: BuilderSectionKey; label: string }> = [
  { key: "identity", label: "Identity" },
  { key: "model", label: "Model" },
  { key: "prompt", label: "Prompt" },
  { key: "tools", label: "Tools" },
  { key: "memory", label: "Memory" },
  { key: "limits", label: "Limits & retries" },
  { key: "guardrails", label: "Guardrails" },
  { key: "review", label: "Review" },
];

export function SectionNav({
  active,
  issues,
  onSelect,
}: {
  active: BuilderSectionKey;
  issues: Issue[];
  onSelect: (s: BuilderSectionKey) => void;
}) {
  return (
    <nav aria-label="Builder sections" className="flex flex-col gap-0.5">
      {SECTIONS.map((s, i) => {
        const sectionIssues = issuesForSection(issues, s.key);
        const hasError = sectionIssues.some((x) => x.severity === "error");
        const hasWarning = !hasError && sectionIssues.some((x) => x.severity === "warning");
        const isActive = active === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            aria-current={isActive ? "step" : undefined}
            className={cn(
              "flex min-h-[36px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                hasError ? "bg-danger/15 text-danger" : hasWarning ? "bg-warning/15 text-warning" : "bg-surface-2 text-muted-foreground",
              )}
              data-tabular
            >
              {hasError ? <AlertCircle className="size-3.5" /> : i + 1}
            </span>
            <span className="flex-1 truncate">{s.label}</span>
            {hasWarning ? <span className="size-1.5 rounded-full bg-warning" aria-label="warnings" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
