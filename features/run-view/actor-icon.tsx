import { Bot, Wrench, GitBranch, ShieldCheck, Plug, Code, Repeat, Circle, type LucideIcon } from "lucide-react";
import type { StepActor } from "@/types/domain";

const ICON: Record<string, LucideIcon> = {
  agent: Bot,
  tool: Wrench,
  decision: GitBranch,
  approval: ShieldCheck,
  api: Plug,
  code: Code,
  loop: Repeat,
};

export function ActorIcon({ actor, className }: { actor: StepActor; className?: string }) {
  const Icon = ICON[actor.kind] ?? Circle;
  return <Icon className={className} aria-hidden="true" />;
}
