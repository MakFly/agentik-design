"use client";

import { useCallback, useState } from "react";
import { authApi } from "@/lib/auth/api";
import {
  EMPTY_QUESTIONNAIRE,
  ONBOARDING_STEP_ORDER,
  type OnboardingStep,
  type QuestionnaireAnswers,
} from "./types";
import { StepWelcome } from "./steps/step-welcome";
import { StepSource } from "./steps/step-source";
import { StepRole } from "./steps/step-role";
import { StepUseCase } from "./steps/step-use-case";
import { StepWorkspace } from "./steps/step-workspace";
import { StepPlatform } from "./steps/step-platform";

type OrgInfo = { name: string; slug: string; teamId: string };

export function OnboardingFlow({
  org,
  initialAnswers,
  onComplete,
}: {
  org: OrgInfo;
  initialAnswers?: QuestionnaireAnswers;
  onComplete: () => void | Promise<void>;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(initialAnswers ?? EMPTY_QUESTIONNAIRE);
  const [busy, setBusy] = useState(false);

  const nextStep = useCallback((from: OnboardingStep): OnboardingStep | null => {
    const idx = ONBOARDING_STEP_ORDER.indexOf(from as (typeof ONBOARDING_STEP_ORDER)[number]);
    if (idx < 0 || idx >= ONBOARDING_STEP_ORDER.length - 1) return null;
    return ONBOARDING_STEP_ORDER[idx + 1]!;
  }, []);

  const advanceFrom = useCallback(
    (from: OnboardingStep) => {
      const next = nextStep(from);
      if (next) setStep(next);
    },
    [nextStep],
  );

  const handleBack = useCallback((from: OnboardingStep) => {
    const idx = ONBOARDING_STEP_ORDER.indexOf(from as (typeof ONBOARDING_STEP_ORDER)[number]);
    if (idx <= 0) {
      setStep("welcome");
      return;
    }
    setStep(ONBOARDING_STEP_ORDER[idx - 1]!);
  }, []);

  const applyAnswers = useCallback((patch: Partial<QuestionnaireAnswers>) => {
    setAnswers((a) => {
      const next = { ...a, ...patch };
      void authApi.saveQuestionnaire(next).catch(() => {});
      return next;
    });
  }, []);

  const finish = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await authApi.completeOnboarding();
      await onComplete();
    } catch {
      setBusy(false);
    }
  }, [busy, onComplete]);

  if (step === "welcome") {
    return <StepWelcome onNext={() => setStep(ONBOARDING_STEP_ORDER[0]!)} />;
  }

  if (step === "source") {
    return (
      <StepSource
        answers={answers}
        onChange={applyAnswers}
        onAdvance={() => advanceFrom("source")}
        onSkip={() => advanceFrom("source")}
        onBack={() => handleBack("source")}
      />
    );
  }

  if (step === "role") {
    return (
      <StepRole
        answers={answers}
        onChange={applyAnswers}
        onAdvance={() => advanceFrom("role")}
        onSkip={() => advanceFrom("role")}
        onBack={() => handleBack("role")}
      />
    );
  }

  if (step === "use_case") {
    return (
      <StepUseCase
        answers={answers}
        onChange={applyAnswers}
        onAdvance={() => advanceFrom("use_case")}
        onSkip={() => advanceFrom("use_case")}
        onBack={() => handleBack("use_case")}
      />
    );
  }

  if (step === "workspace") {
    return (
      <StepWorkspace
        name={org.name}
        slug={org.slug}
        onAdvance={() => advanceFrom("workspace")}
        onBack={() => handleBack("workspace")}
      />
    );
  }

  if (step === "runtime") {
    return (
      <StepPlatform onComplete={() => void finish()} onBack={() => handleBack("runtime")} busy={busy} />
    );
  }

  return null;
}
