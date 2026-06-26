"use client";

import {
  Brain,
  Code2,
  Compass,
  FileEdit,
  ListChecks,
  MoreHorizontal,
  Settings2,
  User,
} from "lucide-react";
import type { QuestionnaireAnswers } from "../types";
import { StepQuestion, type QuestionOption } from "../step-question";

export function StepUseCase({
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
    { slug: "ship_code", icon: <Code2 className="h-4 w-4" />, label: "Ship code with AI agents" },
    { slug: "manage_team", icon: <ListChecks className="h-4 w-4" />, label: "Manage tasks for my team" },
    { slug: "personal_tasks", icon: <User className="h-4 w-4" />, label: "Organize my own tasks" },
    { slug: "plan_research", icon: <Brain className="h-4 w-4" />, label: "Plan, brainstorm, research" },
    { slug: "write_publish", icon: <FileEdit className="h-4 w-4" />, label: "Write, edit, publish" },
    { slug: "automate_ops", icon: <Settings2 className="h-4 w-4" />, label: "Automate ops & workflows" },
    { slug: "evaluate", icon: <Compass className="h-4 w-4" />, label: "Just exploring" },
    { slug: "other", icon: <MoreHorizontal className="h-4 w-4" />, label: "Other", isOther: true },
  ];

  const selected: readonly string[] = [
    ...(answers.use_case ?? []),
    ...(!answers.use_case?.includes("other") && answers.use_case_other ? ["other"] : []),
  ];

  const toggle = (slug: string) => {
    const current = answers.use_case ?? [];
    if (slug === "other") {
      if (current.includes("other")) {
        onChange({ use_case: current.filter((s) => s !== "other"), use_case_other: null });
      } else {
        onChange({ use_case: [...current, "other"] });
      }
      return;
    }
    const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
    onChange({ use_case: next });
  };

  return (
    <StepQuestion
      step="use_case"
      number={3}
      eyebrow="About you"
      question="What do you want to use Multica for?"
      options={options}
      selectedSlugs={selected}
      otherValue={answers.use_case_other ?? ""}
      onOtherChange={(v) => onChange({ use_case_other: v })}
      otherPlaceholder="e.g. study group coordination"
      onAnswer={toggle}
      onAdvance={onAdvance}
      onSkip={() => {
        onChange({ use_case: [], use_case_other: null });
        onSkip();
      }}
      onBack={onBack}
      multiSelect
    />
  );
}
