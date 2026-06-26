import type { ReactNode } from "react";

/** Full-bleed layout for Multica-style onboarding — overrides the narrow entry shell. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-white">{children}</div>;
}
