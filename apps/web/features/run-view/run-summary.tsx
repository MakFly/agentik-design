import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Run } from "@/types/domain";
import { CostMeter } from "@/components/shared/cost-meter";
import { KeyValueList } from "@/components/shared/key-value-list";
import { formatDuration } from "@/lib/format";

export function RunSummary({ team, run }: { team: string; run: Run }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Cost &amp; tokens</h3>
        <CostMeter spent={run.cost.money} cap={run.costCap} tokens={run.cost.tokens} />
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Run metadata</h3>
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
                <Link href={`/${team}/observability/traces/${run.traceId}`} className="inline-flex items-center gap-0.5 text-primary hover:underline">
                  {run.traceId} <ArrowUpRight className="size-3" />
                </Link>
              ),
            },
          ]}
        />
      </section>

      {run.error ? (
        <section className="rounded-lg border border-danger/30 bg-danger-surface/40 p-4">
          <h3 className="mb-1 text-[11px] font-medium tracking-wide text-danger uppercase">Error</h3>
          <p className="text-sm text-foreground">{run.error.message}</p>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
          <h3 className="mb-1 text-[11px] font-medium tracking-wide uppercase">Errors</h3>
          none
        </section>
      )}
    </div>
  );
}
