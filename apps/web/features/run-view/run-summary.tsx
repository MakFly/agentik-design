import Link from "next/link";
import { ArrowUpRight, FileCode2 } from "lucide-react";
import type { Run } from "@/types/domain";
import type { RunProjectContext } from "@/features/projects/types";
import type { RunDetail } from "./api";
import { CostMeter } from "@/components/shared/cost-meter";
import { KeyValueList } from "@/components/shared/key-value-list";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";

export function RunSummary({
  team,
  run,
  projectContext,
  artifacts,
}: {
  team: string;
  run: Run;
  projectContext?: RunProjectContext;
  artifacts?: RunDetail["artifacts"];
}) {
  return (
    <div className="flex flex-col gap-4">
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
                    href={`/${team}/projects/${projectContext.project.id}`}
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

      {artifacts &&
      (artifacts.summary ||
        artifacts.changedFiles.length ||
        artifacts.fileChanges.length ||
        artifacts.tests.length) ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Artifacts
          </h3>
          {artifacts.summary ? (
            <p className="mb-3 line-clamp-4 text-sm leading-5 text-foreground">
              {artifacts.summary}
            </p>
          ) : null}
          {artifacts.fileChanges.length || artifacts.changedFiles.length ? (
            <div className="mb-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Changed files
              </div>
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                {(artifacts.fileChanges.length
                  ? artifacts.fileChanges.slice(0, 12)
                  : artifacts.changedFiles
                      .slice(0, 12)
                      .map((file) => ({
                        path: file,
                        status: "changed",
                        additions: 0,
                        deletions: 0,
                      }))
                ).map((file) => (
                  <div
                    key={`${file.status}-${file.path}`}
                    className="flex min-w-0 items-center gap-2 rounded-md bg-background px-2 py-1 text-xs"
                  >
                    <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <Badge
                      variant="outline"
                      className="shrink-0 font-mono text-[10px]"
                    >
                      {file.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {file.path}
                    </span>
                    {file.additions || file.deletions ? (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        +{file.additions} -{file.deletions}
                      </span>
                    ) : null}
                  </div>
                ))}
                {(artifacts.fileChanges.length ||
                  artifacts.changedFiles.length) > 12 ? (
                  <div className="text-xs text-muted-foreground">
                    +
                    {(artifacts.fileChanges.length ||
                      artifacts.changedFiles.length) - 12}{" "}
                    more
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {artifacts.tests.length ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Checks
              </div>
              <div className="flex flex-col gap-1">
                {artifacts.tests.slice(0, 6).map((test) => (
                  <div
                    key={`${test.name}-${test.status}`}
                    className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-xs"
                  >
                    <span className="truncate font-mono">{test.name}</span>
                    <Badge
                      variant={
                        test.status === "passed" || test.status === "ok"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {test.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

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
                  href={`/${team}/observability/traces/${run.traceId}`}
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
