import type { ReactNode } from "react";

/** Entry funnel root — child route groups supply their own shell (narrow auth vs full-bleed onboarding). */
export default function EntryLayout({ children }: { children: ReactNode }) {
  return children;
}
