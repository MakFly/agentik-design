import {
  Bot,
  Sparkles,
  Wrench,
  Globe,
  Database,
  GitBranch,
  ShieldCheck,
  Workflow,
  ShieldQuestion,
  Circle,
  type LucideIcon,
} from "lucide-react";
import type { SpanCategory, SpanStatusCode } from "@/types/observability";

interface CategoryMeta {
  label: string;
  Icon: LucideIcon;
  /** solid bar fill on the waterfall */
  bar: string;
  /** icon / accent text color */
  text: string;
}

/** Category → semantic color from the color-blind-safe chart palette (globals.css §data-viz). */
export const CATEGORY_META: Record<SpanCategory, CategoryMeta> = {
  agent: { label: "Agent", Icon: Bot, bar: "bg-chart-1", text: "text-chart-1" },
  llm: { label: "LLM", Icon: Sparkles, bar: "bg-chart-6", text: "text-chart-6" },
  tool: { label: "Tool", Icon: Wrench, bar: "bg-chart-3", text: "text-chart-3" },
  http: { label: "HTTP", Icon: Globe, bar: "bg-chart-2", text: "text-chart-2" },
  memory: { label: "Memory", Icon: Database, bar: "bg-chart-4", text: "text-chart-4" },
  decision: { label: "Decision", Icon: GitBranch, bar: "bg-neutral", text: "text-neutral" },
  guardrail: { label: "Guardrail", Icon: ShieldCheck, bar: "bg-chart-5", text: "text-chart-5" },
  workflow: { label: "Workflow", Icon: Workflow, bar: "bg-neutral", text: "text-neutral" },
  approval: { label: "Approval", Icon: ShieldQuestion, bar: "bg-info", text: "text-info" },
};

export function categoryMeta(category: SpanCategory): CategoryMeta {
  return CATEGORY_META[category] ?? { label: category, Icon: Circle, bar: "bg-neutral", text: "text-neutral" };
}

/** Bar fill for a span — errors always read red, regardless of category. */
export function spanBarClass(category: SpanCategory, status: SpanStatusCode): string {
  if (status === "error") return "bg-danger";
  return categoryMeta(category).bar;
}
