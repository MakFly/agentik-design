"use client";

import { type ReactNode, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStep } from "./types";
import { StepHeader } from "./step-header";
import { IconOptionCard, IconOtherOptionCard } from "./icon-option-card";

export type QuestionOption = {
  slug: string;
  icon: ReactNode;
  label: string;
  isOther?: boolean;
};

export function StepQuestion({
  step,
  number,
  eyebrow,
  question,
  options,
  selectedSlugs,
  otherValue,
  onOtherChange,
  otherPlaceholder,
  onAnswer,
  onAdvance,
  onSkip,
  onBack,
  multiSelect = false,
}: {
  step: OnboardingStep;
  number: number;
  eyebrow?: string;
  question: string;
  options: readonly QuestionOption[];
  selectedSlugs: readonly string[];
  otherValue: string;
  onOtherChange: (value: string) => void;
  otherPlaceholder: string;
  onAnswer: (slug: string) => void;
  onAdvance: () => void;
  onSkip: () => void;
  onBack?: () => void;
  multiSelect?: boolean;
}) {
  const [pendingOther, setPendingOther] = useState(false);

  const handleSelect = (option: QuestionOption) => {
    if (option.isOther) {
      setPendingOther(true);
      onAnswer(option.slug);
      return;
    }
    setPendingOther(false);
    onAnswer(option.slug);
  };

  const otherOption = options.find((o) => o.isOther) ?? null;
  const otherSelected = otherOption ? selectedSlugs.includes(otherOption.slug) : false;
  const otherActive = otherSelected || pendingOther;
  const otherFilled = (otherValue ?? "").trim().length > 0;
  const hasNonOtherSelection = selectedSlugs.some((slug) => slug !== otherOption?.slug);
  const canContinue =
    selectedSlugs.length > 0 && (hasNonOtherSelection || !otherActive || otherFilled);

  const singlePicked =
    selectedSlugs.length === 1 ? (options.find((o) => o.slug === selectedSlugs[0]) ?? null) : null;
  const footerHint = canContinue
    ? singlePicked
      ? `Selected: ${singlePicked.label}`
      : "Looks good. Hit Continue when you're ready."
    : "Pick one to continue — or skip if you'd rather not say.";

  return (
    <div className="mul-landing animate-onboarding-enter flex min-h-dvh flex-col bg-white">
      <header className="flex shrink-0 items-center gap-4 bg-white px-6 py-3 sm:px-10 md:px-14 lg:px-16">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-[var(--mul-muted)] transition-colors hover:text-[var(--mul-ink)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        ) : (
          <span aria-hidden className="w-0" />
        )}
        <div className="flex-1">
          <StepHeader currentStep={step} />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-6 py-10 sm:px-10 md:px-14 lg:py-14">
          {eyebrow ? (
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--mul-muted)]">
              {eyebrow}
            </div>
          ) : null}
          <div className="mb-1 font-mono text-xs text-[var(--mul-muted)]">{String(number).padStart(2, "0")}</div>
          <h1 className="mul-onboarding-serif text-balance text-[34px] font-medium leading-[1.15] tracking-tight text-[var(--mul-ink)]">
            {question}
          </h1>

          <fieldset
            role={multiSelect ? "group" : "radiogroup"}
            aria-label={question}
            className="mt-10 m-0 grid grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {options.map((option) =>
              option.isOther ? (
                <IconOtherOptionCard
                  key={option.slug}
                  icon={option.icon}
                  label={option.label}
                  selected={otherActive}
                  onSelect={() => handleSelect(option)}
                  otherValue={otherValue}
                  onOtherChange={onOtherChange}
                  onConfirm={() => canContinue && onAdvance()}
                  placeholder={otherPlaceholder}
                  mode={multiSelect ? "checkbox" : "radio"}
                />
              ) : (
                <IconOptionCard
                  key={option.slug}
                  icon={option.icon}
                  label={option.label}
                  selected={selectedSlugs.includes(option.slug)}
                  onSelect={() => handleSelect(option)}
                  mode={multiSelect ? "checkbox" : "radio"}
                />
              ),
            )}
          </fieldset>

          <div className="mt-8 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <span aria-live="polite" className="mr-auto text-xs text-[var(--mul-muted)]">
              {footerHint}
            </span>
            <div className="flex items-center gap-2">
              <Button size="lg" variant="secondary" onClick={onSkip}>
                Skip
              </Button>
              <Button size="lg" disabled={!canContinue} onClick={onAdvance}>
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
