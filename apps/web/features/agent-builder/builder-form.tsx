"use client";

import type { BuilderSectionKey, Issue } from "./validation";
import { issuesForSection } from "./validation";
import { PersonaSection } from "./sections/persona-section";
import { RuntimeSection } from "./sections/runtime-section";
import { ToolsSection } from "./sections/tools-section";
import { MemorySection } from "./sections/memory-section";
import { DelegationSection } from "./sections/delegation-section";
import { ReactivitySection } from "./sections/reactivity-section";
import { PolicySection } from "./sections/policy-section";
import { ReviewSection } from "./sections/review-section";

export function BuilderForm({
  section,
  issues,
  team,
  mode,
  agentId,
}: {
  section: BuilderSectionKey;
  issues: Issue[];
  team: string;
  mode: "create" | "edit";
  agentId?: string;
}) {
  const sectionIssues = issuesForSection(issues, section);

  switch (section) {
    case "persona":
      return <PersonaSection issues={sectionIssues} />;
    case "runtime":
      return <RuntimeSection issues={sectionIssues} />;
    case "tools":
      return <ToolsSection issues={sectionIssues} />;
    case "memory":
      return <MemorySection />;
    case "delegation":
      return <DelegationSection team={team} mode={mode} agentId={agentId} />;
    case "reactivity":
      return <ReactivitySection team={team} mode={mode} agentId={agentId} />;
    case "policy":
      return <PolicySection issues={sectionIssues} />;
    case "review":
      return <ReviewSection issues={issues} />;
  }
}
