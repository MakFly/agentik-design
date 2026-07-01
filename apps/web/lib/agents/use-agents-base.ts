"use client";

import { usePathname } from "next/navigation";

/**
 * The agents base path for the CURRENT surface. The agents registry + builder are shared
 * between the assistant and the platform; deriving the base from the pathname keeps all
 * agent navigation (list, detail, new, edit, publish) within whichever surface you're on —
 * so editing an agent from /{team}/assistant/agents stays in the assistant, and from
 * /{team}/platform/agents stays in the platform. Same components, iso experience.
 */
export function agentsBaseFor(team: string, pathname: string | null): string {
  const surface = pathname?.includes(`/${team}/assistant/`) ? "assistant" : "platform";
  return `/${team}/${surface}/agents`;
}

export function useAgentsBase(team: string): string {
  return agentsBaseFor(team, usePathname());
}
