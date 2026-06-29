"use client";

import { AlertCircle, Check } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { BuilderSectionKey, Issue } from "./validation";
import { issuesForSection } from "./validation";
import { cn } from "@/lib/utils";

/**
 * Section keys are stable (validation/issuesForSection depend on them); only the
 * labels + order follow the OpenClaw × Hermes operator vocabulary. Delegation
 * (subagents) sits before Channels, mirroring Hermes' config grouping.
 */
export const SECTIONS: Array<{ key: BuilderSectionKey; label: string }> = [
  { key: "persona", label: "Identity & Personality" },
  { key: "runtime", label: "Model & Execution" },
  { key: "tools", label: "Skills & Tools" },
  { key: "memory", label: "Memory & Context" },
  { key: "delegation", label: "Subagents" },
  { key: "reactivity", label: "Channels" },
  { key: "policy", label: "Policy & Access" },
  { key: "review", label: "Review & Publish" },
];

function statusOf(issues: Issue[], key: BuilderSectionKey) {
  const sectionIssues = issuesForSection(issues, key);
  const hasError = sectionIssues.some((x) => x.severity === "error");
  const hasWarning = !hasError && sectionIssues.some((x) => x.severity === "warning");
  return { hasError, hasWarning, done: !hasError && !hasWarning };
}

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
    <>
      {/* mobile: compact section picker */}
      <div className="lg:hidden">
        <Select value={active} onValueChange={(v) => onSelect(v as BuilderSectionKey)}>
          <SelectTrigger className="min-h-[44px] w-full" aria-label="Builder section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((s) => {
              const { hasError } = statusOf(issues, s.key);
              return (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                  {hasError ? " · needs attention" : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* desktop: vertical rail */}
      <nav aria-label="Builder sections" className="hidden flex-col gap-0.5 lg:flex">
        {SECTIONS.map((s, i) => {
          const { hasError, hasWarning, done } = statusOf(issues, s.key);
          const isActive = active === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s.key)}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex min-h-[44px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                isActive
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                  hasError
                    ? "bg-danger/15 text-danger"
                    : hasWarning
                      ? "bg-warning/15 text-warning"
                      : done
                        ? "bg-success/15 text-success"
                        : "bg-surface-2 text-muted-foreground",
                )}
                data-tabular
              >
                {hasError ? <AlertCircle className="size-3.5" /> : done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="flex-1 truncate">{s.label}</span>
              {hasWarning ? <span className="size-1.5 rounded-full bg-warning" aria-label="warnings" /> : null}
            </button>
          );
        })}
      </nav>
    </>
  );
}
