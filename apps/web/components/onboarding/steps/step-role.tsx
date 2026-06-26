"use client";

import {
  Briefcase,
  Code2,
  GraduationCap,
  Megaphone,
  MoreHorizontal,
  Palette,
  PenLine,
  Rocket,
  Search,
  Settings2,
} from "lucide-react";
import type { QuestionnaireAnswers } from "../types";
import { StepQuestion, type QuestionOption } from "../step-question";

export function StepRole({
  answers,
  onChange,
  onAdvance,
  onSkip,
  onBack,
}: {
  answers: QuestionnaireAnswers;
  onChange: (patch: Partial<QuestionnaireAnswers>) => void;
  onAdvance: () => void;
  onSkip: () => void;
  onBack?: () => void;
}) {
  const options: QuestionOption[] = [
    { slug: "engineer", icon: <Code2 className="h-4 w-4" />, label: "Engineer / developer" },
    { slug: "product", icon: <Briefcase className="h-4 w-4" />, label: "Product manager" },
    { slug: "designer", icon: <Palette className="h-4 w-4" />, label: "Designer" },
    { slug: "founder", icon: <Rocket className="h-4 w-4" />, label: "Founder / exec" },
    { slug: "marketing", icon: <Megaphone className="h-4 w-4" />, label: "Marketing / growth" },
    { slug: "writer", icon: <PenLine className="h-4 w-4" />, label: "Writer / content" },
    { slug: "research", icon: <Search className="h-4 w-4" />, label: "Researcher / analyst" },
    { slug: "ops", icon: <Settings2 className="h-4 w-4" />, label: "Operations / project mgmt" },
    { slug: "student", icon: <GraduationCap className="h-4 w-4" />, label: "Student / personal use" },
    { slug: "other", icon: <MoreHorizontal className="h-4 w-4" />, label: "Other", isOther: true },
  ];

  const selectedSlug = answers.role ?? (answers.role_other ? "other" : null);
  const selected: readonly string[] = selectedSlug ? [selectedSlug] : [];

  return (
    <StepQuestion
      step="role"
      number={2}
      eyebrow="About you"
      question="Which best describes you?"
      options={options}
      selectedSlugs={selected}
      otherValue={answers.role_other ?? ""}
      onOtherChange={(v) => onChange({ role_other: v })}
      otherPlaceholder="e.g. teacher, support lead"
      onAnswer={(slug) => {
        if (slug === "other") {
          onChange({ role: "other" });
        } else {
          onChange({ role: slug, role_other: null });
        }
      }}
      onAdvance={onAdvance}
      onSkip={() => {
        onChange({ role: null, role_other: null });
        onSkip();
      }}
      onBack={onBack}
    />
  );
}
