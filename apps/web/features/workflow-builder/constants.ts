import {
  Zap,
  Bot,
  Wrench,
  Globe,
  GitBranch,
  ShieldCheck,
  Code,
  Repeat,
  Workflow,
  CircleStop,
} from "lucide-react";
import type { ElementType } from "react";
import type { NodeType } from "@/types/domain";

export interface NodeTypeConfig {
  type: NodeType;
  label: string;
  description: string;
  icon: ElementType;
  category: "triggers" | "agents" | "logic" | "actions";
  accentVar: string;
  bgVar: string;
}

export const NODE_TYPE_CONFIGS: Record<NodeType, NodeTypeConfig> = {
  trigger: {
    type: "trigger",
    label: "Trigger",
    description: "Start the workflow",
    icon: Zap,
    category: "triggers",
    accentVar: "--success",
    bgVar: "--success-surface",
  },
  agent: {
    type: "agent",
    label: "Agent",
    description: "Run an AI agent",
    icon: Bot,
    category: "agents",
    accentVar: "--primary",
    bgVar: "--accent",
  },
  tool: {
    type: "tool",
    label: "Tool",
    description: "Execute an external tool",
    icon: Wrench,
    category: "actions",
    accentVar: "--warning",
    bgVar: "--warning-surface",
  },
  api: {
    type: "api",
    label: "HTTP Request",
    description: "Call an external API",
    icon: Globe,
    category: "actions",
    accentVar: "--chart-6",
    bgVar: "--surface-2",
  },
  decision: {
    type: "decision",
    label: "Decision",
    description: "Branch on conditions",
    icon: GitBranch,
    category: "logic",
    accentVar: "--chart-4",
    bgVar: "--warning-surface",
  },
  approval: {
    type: "approval",
    label: "Approval",
    description: "Wait for human approval",
    icon: ShieldCheck,
    category: "logic",
    accentVar: "--chart-5",
    bgVar: "--danger-surface",
  },
  code: {
    type: "code",
    label: "Code",
    description: "Run JavaScript code",
    icon: Code,
    category: "actions",
    accentVar: "--neutral",
    bgVar: "--surface-2",
  },
  loop: {
    type: "loop",
    label: "Loop",
    description: "Iterate over a collection",
    icon: Repeat,
    category: "logic",
    accentVar: "--chart-2",
    bgVar: "--info-surface",
  },
  subflow: {
    type: "subflow",
    label: "Sub-workflow",
    description: "Run another workflow",
    icon: Workflow,
    category: "actions",
    accentVar: "--info",
    bgVar: "--info-surface",
  },
  end: {
    type: "end",
    label: "End",
    description: "End the workflow",
    icon: CircleStop,
    category: "logic",
    accentVar: "--danger",
    bgVar: "--danger-surface",
  },
};

export const PALETTE_CATEGORIES = [
  { key: "triggers" as const, label: "Triggers" },
  { key: "agents" as const, label: "Agents" },
  { key: "logic" as const, label: "Logic" },
  { key: "actions" as const, label: "Actions" },
] as const;
