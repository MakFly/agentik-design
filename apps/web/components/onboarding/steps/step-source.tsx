"use client";

import {
  Briefcase,
  CalendarDays,
  Globe,
  HelpCircle,
  MoreHorizontal,
  Newspaper,
  Users,
} from "lucide-react";
import type { QuestionnaireAnswers } from "../types";
import {
  GitHubIcon,
  GoogleIcon,
  LinkedInIcon,
  OpenAIIcon,
  XIcon,
  YouTubeIcon,
} from "../brand-icons";
import { StepQuestion, type QuestionOption } from "../step-question";

export function StepSource({
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
    { slug: "friends_colleagues", icon: <Users className="h-4 w-4" />, label: "Friends or colleagues" },
    { slug: "search", icon: <GoogleIcon className="h-[18px] w-[18px]" />, label: "Google / search" },
    { slug: "social_x", icon: <XIcon className="h-[15px] w-[15px]" />, label: "X / Twitter" },
    { slug: "social_linkedin", icon: <LinkedInIcon className="h-[18px] w-[18px]" />, label: "LinkedIn" },
    { slug: "social_youtube", icon: <YouTubeIcon className="h-[18px] w-[18px]" />, label: "YouTube" },
    { slug: "social_github", icon: <GitHubIcon className="h-[18px] w-[18px]" />, label: "GitHub" },
    { slug: "social_other", icon: <Globe className="h-4 w-4" />, label: "Other social" },
    { slug: "blog_newsletter", icon: <Newspaper className="h-4 w-4" />, label: "Blog / newsletter" },
    { slug: "ai_assistant", icon: <OpenAIIcon className="h-[16px] w-[16px]" />, label: "ChatGPT / Claude / Cursor" },
    { slug: "from_work", icon: <Briefcase className="h-4 w-4" />, label: "At work" },
    { slug: "event_conference", icon: <CalendarDays className="h-4 w-4" />, label: "Conference / meetup" },
    { slug: "dont_remember", icon: <HelpCircle className="h-4 w-4" />, label: "Don't remember" },
    { slug: "other", icon: <MoreHorizontal className="h-4 w-4" />, label: "Other", isOther: true },
  ];

  const selected: readonly string[] = answers.source?.[0] ? [answers.source[0]] : [];

  return (
    <StepQuestion
      step="source"
      number={1}
      eyebrow="About you"
      question="How did you hear about Multica?"
      options={options}
      selectedSlugs={selected}
      otherValue={answers.source_other ?? ""}
      onOtherChange={(v) => onChange({ source_other: v })}
      otherPlaceholder="e.g. a podcast I listen to"
      onAnswer={(slug) =>
        onChange({
          source: [slug],
          source_other: slug === "other" ? answers.source_other : null,
        })
      }
      onAdvance={onAdvance}
      onSkip={() => {
        onChange({ source: [], source_other: null });
        onSkip();
      }}
      onBack={onBack}
    />
  );
}
