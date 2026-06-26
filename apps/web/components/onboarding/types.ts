export const ONBOARDING_STEP_ORDER = [
  "source",
  "role",
  "use_case",
  "workspace",
  "runtime",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_ORDER)[number] | "welcome";

export type QuestionnaireAnswers = {
  source: string[];
  source_other: string | null;
  role: string | null;
  role_other: string | null;
  use_case: string[];
  use_case_other: string | null;
};

export const EMPTY_QUESTIONNAIRE: QuestionnaireAnswers = {
  source: [],
  source_other: null,
  role: null,
  role_other: null,
  use_case: [],
  use_case_other: null,
};
