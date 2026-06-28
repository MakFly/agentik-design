"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useBuilderStore } from "../store-context";
import type { BuilderSectionKey, Issue } from "../validation";
import { SectionHeading } from "./section-kit";

const SECTION_LABEL: Record<BuilderSectionKey, string> = {
  persona: "Persona",
  runtime: "Runtime & model",
  tools: "Tools",
  memory: "Memory",
  reactivity: "Reactivity",
  delegation: "Delegation",
  policy: "Policy & approval",
  review: "Review",
};

export function ReviewSection({ issues }: { issues: Issue[] }) {
  const setActiveSection = useBuilderStore((s) => s.setActiveSection);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <SectionHeading title="Review" hint="Resolve every error before publishing." />

      {errors.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success-surface/40 p-3 text-sm">
          <CheckCircle2 className="size-4 text-success" />
          Configuration is valid and ready to publish.
        </div>
      ) : (
        <div className="rounded-md border border-danger/30 bg-danger-surface/40 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle className="size-4" /> {errors.length} issue{errors.length > 1 ? "s" : ""} block publishing
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-foreground">
            {errors.map((e, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setActiveSection(e.section)}
                  className="text-left underline-offset-2 hover:underline"
                >
                  <span className="font-medium">{SECTION_LABEL[e.section]}</span>: {e.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning-surface/40 p-3">
          {warnings.map((w, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveSection(w.section)}
              className="flex items-start gap-1.5 text-left text-xs text-foreground hover:underline"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>
                <span className="font-medium">{SECTION_LABEL[w.section]}</span>: {w.message}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
