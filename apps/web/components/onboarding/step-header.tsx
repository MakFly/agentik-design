"use client";

import { cn } from "@/lib/utils";
import { ONBOARDING_STEP_ORDER, type OnboardingStep } from "./types";

export function StepHeader({ currentStep }: { currentStep: OnboardingStep }) {
  const total = ONBOARDING_STEP_ORDER.length;
  const currentIndex = ONBOARDING_STEP_ORDER.indexOf(currentStep as (typeof ONBOARDING_STEP_ORDER)[number]);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;

  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={safeIndex + 1}
      aria-label={`Step ${safeIndex + 1} of ${total}`}
      className="flex w-full items-center justify-between py-2"
    >
      <div className="flex items-center gap-2">
        {ONBOARDING_STEP_ORDER.map((stepId, i) => {
          const isDone = i < safeIndex;
          const isCurrent = i === safeIndex;
          return (
            <span
              key={stepId}
              aria-hidden
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                isDone && "bg-[var(--mul-ink)]",
                isCurrent && "bg-[var(--mul-ink)] ring-2 ring-[var(--mul-ink)]/30 ring-offset-2 ring-offset-white",
                !isDone && !isCurrent && "bg-[var(--mul-line)]",
              )}
            />
          );
        })}
      </div>
      <span className="text-xs font-medium text-[var(--mul-muted)]">
        Step {safeIndex + 1} of {total}
      </span>
    </div>
  );
}
