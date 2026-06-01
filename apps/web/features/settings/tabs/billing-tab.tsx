"use client";

import { CreditCard, AlertTriangle, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { useBilling } from "../api";
import { cn } from "@/lib/utils";

function Meter({ label, used, total, valueText }: { label: string; used: number; total: number; valueText: string }) {
  const ratio = total > 0 ? used / total : 0;
  const tone = ratio >= 1 ? "bg-danger" : ratio >= 0.85 ? "bg-warning" : "bg-primary";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums" data-tabular>
          {valueText}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{formatPercent(ratio)} of plan</span>
    </div>
  );
}

const INVOICE_TONE = { paid: "secondary", open: "outline", void: "outline" } as const;

export function BillingTab({ team }: { team: string }) {
  const { data, isLoading, isError, error, refetch } = useBilling(team);

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const overBudget = data.usedSpend.amountCents > data.budgetPerMonth.amountCents;

  return (
    <div className="flex flex-col gap-4">
      {overBudget && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-surface/40 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Monthly spend has exceeded the configured budget of {formatMoney(data.budgetPerMonth)}.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Plan" value={data.plan} sublabel="Billed monthly" icon={CreditCard} />
        <StatCard label="Runs this period" value={formatNumber(data.usedRuns)} sublabel={`of ${formatNumber(data.includedRuns)} included`} />
        <StatCard label="Spend this period" value={formatMoney(data.usedSpend)} sublabel={`budget ${formatMoney(data.budgetPerMonth)}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage vs included</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 p-5 pt-0 sm:grid-cols-2">
          <Meter label="Runs" used={data.usedRuns} total={data.includedRuns} valueText={`${formatNumber(data.usedRuns)} / ${formatNumber(data.includedRuns)}`} />
          <Meter label="Spend" used={data.usedSpend.amountCents} total={data.includedSpend.amountCents} valueText={`${formatMoney(data.usedSpend)} / ${formatMoney(data.includedSpend)}`} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spend by agent</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-5 pt-0">
            {data.spendByAgent.map((s) => (
              <div key={s.agent} className="flex items-center justify-between text-sm">
                <span className="truncate text-foreground">{s.agent}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  <span className="tabular-nums" data-tabular>
                    {formatNumber(s.runs)} runs
                  </span>
                  <span className="w-16 text-right font-medium tabular-nums text-foreground" data-tabular>
                    {formatMoney(s.amount)}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoices</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-5 pt-0">
            {data.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-foreground">{inv.period}</span>
                  <Badge variant={INVOICE_TONE[inv.status]} className="capitalize">
                    {inv.status}
                  </Badge>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium tabular-nums text-foreground" data-tabular>
                    {formatMoney(inv.amount)}
                  </span>
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Download invoice ${inv.period}`}>
                    <Download className="size-4" />
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
