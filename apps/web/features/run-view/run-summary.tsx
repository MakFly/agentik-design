import Link from "next/link";
import { ArrowUpRight, Bot, MessageSquareText, Paperclip, Workflow } from "lucide-react";
import type { Run } from "@/types/domain";
import type { RunProjectContext } from "@/features/projects/types";
import { CostMeter } from "@/components/shared/cost-meter";
import { KeyValueList } from "@/components/shared/key-value-list";
import { formatDuration } from "@/lib/format";

export function RunSummary({
  team,
  run,
  projectContext,
}: {
  team: string;
  run: Run;
  projectContext?: RunProjectContext;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Cost &amp; tokens
        </h3>
        <CostMeter
          spent={run.cost.money}
          cap={run.costCap}
          tokens={run.cost.tokens}
        />
      </section>

      {projectContext ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Project task
          </h3>
          <KeyValueList
            items={[
              {
                label: "Project",
                value: (
                  <Link
                    href={`/${team}/platform/projects/${projectContext.project.id}`}
                    className="text-primary hover:underline"
                  >
                    {projectContext.project.name}
                  </Link>
                ),
              },
              { label: "Task", value: projectContext.task.title },
              { label: "Priority", value: projectContext.task.priority },
              { label: "Resources", value: projectContext.resources.length },
              { label: "Workspaces", value: projectContext.workspaces.length },
            ]}
          />
        </section>
      ) : null}

      <OperatorInputPanel run={run} />
      <OrchestrationPlanPanel team={team} run={run} />

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Run metadata
        </h3>
        <KeyValueList
          items={[
            { label: "Trigger", value: run.trigger.kind },
            { label: "Environment", value: run.env },
            { label: "Subject", value: run.subjectName ?? run.subject.kind },
            { label: "Steps", value: `${run.completedSteps}/${run.stepCount}` },
            { label: "Duration", value: formatDuration(run.durationMs) },
            {
              label: "Trace",
              value: (
                <Link
                  href={`/${team}/platform/observability/traces/${run.traceId}`}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  {run.traceId} <ArrowUpRight className="size-3" />
                </Link>
              ),
            },
          ]}
        />
      </section>

      {run.error ? (
        <section className="rounded-lg border border-danger/30 bg-danger-surface/40 p-4">
          <h3 className="mb-1 text-[11px] font-medium tracking-wide text-danger uppercase">
            Error
          </h3>
          <p className="text-sm text-foreground">{run.error.message}</p>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
          <h3 className="mb-1 text-[11px] font-medium tracking-wide uppercase">
            Errors
          </h3>
          none
        </section>
      )}
    </div>
  );
}

function OrchestrationPlanPanel({ team, run }: { team: string; run: Run }) {
  const plan = summarizeOrchestrationPlan(run.input);
  if (!plan) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Workflow className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Subagent plan
        </h3>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {plan.completed}/{plan.total}
        </span>
      </div>
      <p className="mb-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
        {plan.goal}
      </p>
      <div className="flex flex-col gap-2">
        {plan.steps.map((step) => (
          <div
            key={`${step.index}-${step.agentName}`}
            className="rounded-md border border-border/70 bg-background px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {step.index + 1}
              </span>
              <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {step.agentName}
              </span>
              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {step.status}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {step.prompt}
            </p>
            {step.childRunId ? (
              <Link
                href={`/${team}/platform/runs/${step.childRunId}`}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                Open child run <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function OperatorInputPanel({ run }: { run: Run }) {
  const input = summarizeRunInput(run.input);
  if (!input) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <MessageSquareText className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Operator input
        </h3>
      </div>
      <KeyValueList
        items={[
          { label: "Source", value: input.source },
          ...(input.attachments
            ? [
                {
                  label: "Attachments",
                  value: (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="size-3" aria-hidden="true" />
                      {input.attachments}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      <p className="mt-3 line-clamp-5 whitespace-pre-wrap rounded-md bg-background px-3 py-2 text-xs leading-5 text-foreground">
        {input.preview}
      </p>
    </section>
  );
}

export function summarizeRunInput(input: Run["input"]): {
  source: string;
  preview: string;
  attachments?: string;
} | null {
  if (!input || typeof input !== "object") return null;
  const prompt = stringValue(input.prompt) ?? stringValue(input.rawPrompt);
  const orchestration = objectValue(input.orchestration);
  if (orchestration) {
    const goal = stringValue(orchestration.goal);
    return {
      source: "Orchestration",
      preview: clip(goal ?? JSON.stringify(orchestration)),
    };
  }
  if (!prompt) return null;
  return {
    source: detectPromptSource(prompt),
    preview: clip(cleanPromptPreview(prompt)),
    attachments: summarizeTelegramAttachments(prompt),
  };
}

export function summarizeOrchestrationPlan(input: Run["input"]): {
  goal: string;
  total: number;
  completed: number;
  steps: Array<{
    index: number;
    agentName: string;
    prompt: string;
    status: string;
    childRunId?: string;
  }>;
} | null {
  const orchestration = input && typeof input === "object"
    ? objectValue(input.orchestration)
    : null;
  const rawSteps = Array.isArray(orchestration?.steps) ? orchestration.steps : [];
  if (!orchestration || !rawSteps.length) return null;
  const steps = rawSteps
    .map((raw, fallbackIndex) => {
      const step = objectValue(raw);
      if (!step) return null;
      const index = numberValue(step.index) ?? fallbackIndex;
      const agentName = stringValue(step.agentName) ?? stringValue(step.agentId) ?? "Agent";
      const prompt = stringValue(step.prompt) ?? "";
      const status = stringValue(step.status) ?? "pending";
      const childRunId = stringValue(step.childRunId) ?? undefined;
      return { index, agentName, prompt, status, childRunId };
    })
    .filter((step): step is NonNullable<typeof step> => Boolean(step))
    .sort((a, b) => a.index - b.index);
  if (!steps.length) return null;
  return {
    goal: stringValue(orchestration.goal) ?? "Orchestration",
    total: steps.length,
    completed: steps.filter((step) => step.status === "succeeded").length,
    steps,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detectPromptSource(prompt: string) {
  if (/^telegram\s*[·:-]/i.test(prompt) || prompt.includes("Pièces jointes Telegram")) {
    return "Telegram";
  }
  return "Direct";
}

function summarizeTelegramAttachments(prompt: string) {
  const metadata = prompt.match(/Pièces jointes Telegram\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const previewCount = (prompt.match(/Aperçu du fichier/g) ?? []).length;
  if (!metadata && previewCount === 0) return undefined;
  return [metadata, previewCount ? `${previewCount} preview${previewCount > 1 ? "s" : ""}` : null]
    .filter(Boolean)
    .join(" · ");
}

function cleanPromptPreview(prompt: string) {
  return prompt
    .replace(/Pièces jointes Telegram\s*:[\s\S]*$/i, "")
    .trim() || prompt;
}

function clip(text: string, max = 240) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}
