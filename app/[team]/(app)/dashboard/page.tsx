import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Play, AlertTriangle, DollarSign, ArrowRight, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CostMeter } from "@/components/shared/cost-meter";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDuration } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

const usd = (amountCents: number) => ({ amountCents, currency: "USD" as const });

// NOTE: static sample data for P0. P1 replaces this with team-scoped TanStack
// Query hooks over the MSW-mocked /dashboard/summary contract (docs/04 §9).
const LIVE_RUNS = [
  { id: "run_8f2", name: "Support Triage Flow", status: "running", step: "4/7", cost: usd(12) },
  { id: "run_7a1", name: "Support Agent", status: "waiting_approval", step: "—", cost: usd(8) },
  { id: "run_9c4", name: "Data sync", status: "running", step: "2/3", cost: usd(4) },
];

const APPROVALS = [
  { id: "ap_1", title: "Refund > $500", run: "run_7a1", ago: "3m ago" },
  { id: "ap_2", title: "Send email to customer", run: "run_9c4", ago: "6m ago" },
];

const ACTIVITY = [
  { id: "run_8e0", name: "Invoice agent", status: "succeeded", dur: 12_000, cost: usd(3) },
  { id: "run_8d9", name: "Scraper", status: "failed", dur: 4_000, cost: usd(2) },
  { id: "run_8d2", name: "Triage Flow", status: "succeeded", dur: 69_000, cost: usd(21) },
  { id: "run_8c7", name: "Resolve agent", status: "succeeded", dur: 5_400, cost: usd(11) },
];

export default async function DashboardPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="System health, activity, and spend at a glance."
        actions={<Button variant="outline" size="sm">Export</Button>}
      />

      {/* system status */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          Operational
        </span>
        <span className="text-muted-foreground">3 active runs</span>
        <span className="text-muted-foreground">12 agents online</span>
        <span className="text-muted-foreground tabular-nums" data-tabular>p95 latency 4.2s</span>
        <span className="text-muted-foreground">0 incidents</span>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active agents" value={12} icon={Bot} sublabel="9 idle · 3 busy" series={[4, 6, 5, 8, 7, 9, 12]} href={`/${team}/agents`} />
        <StatCard label="Running tasks" value={3} icon={Play} sublabel="2 workflows · 1 agent" series={[1, 2, 2, 3, 4, 3, 3]} href={`/${team}/runs`} />
        <StatCard label="Failed (24h)" value={7} icon={AlertTriangle} delta={{ text: "+2", tone: "bad", direction: "up" }} series={[5, 4, 6, 3, 2, 4, 7]} href={`/${team}/runs?status=failed`} />
        <StatCard label="Spend (24h)" value={formatMoney(usd(4820))} icon={DollarSign} sublabel="of $200 budget · 24%" series={[10, 18, 24, 30, 36, 42, 48]} href={`/${team}/observability`} />
      </div>

      {/* live runs + approvals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Live runs</CardTitle>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${team}/runs`}>
                  View all <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {LIVE_RUNS.map((r) => (
              <Link
                key={r.id}
                href={`/${team}/runs/${r.id}`}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <StatusBadge status={r.status} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums" data-tabular>step {r.step}</span>
                <span className="w-14 text-right text-xs font-medium tabular-nums" data-tabular>{formatMoney(r.cost)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-info" /> Approvals waiting
              <span className="ml-1 rounded-full bg-info/10 px-1.5 text-xs font-semibold text-info">{APPROVALS.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {APPROVALS.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.run} · {a.ago}</p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${team}/runs/${a.run}`}>Review</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* recent activity + performance */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {ACTIVITY.map((r) => (
              <Link
                key={r.id}
                href={`/${team}/runs/${r.id}`}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <StatusBadge status={r.status} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums" data-tabular>{formatDuration(r.dur)}</span>
                <span className="w-14 text-right text-xs font-medium tabular-nums" data-tabular>{formatMoney(r.cost)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Metric label="Success rate" value="97.1%" delta="+0.4" tone="good" />
            <Metric label="Avg latency" value="3.8s" delta="-0.2" tone="good" />
            <Metric label="Tool error %" value="1.2%" />
            <div className="mt-1">
              <CostMeter spent={usd(4820)} cap={usd(20000)} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, delta, tone }: { label: string; value: string; delta?: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-semibold tabular-nums" data-tabular>{value}</span>
        {delta ? (
          <span className={tone === "good" ? "text-xs text-success" : tone === "bad" ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
            {delta}
          </span>
        ) : null}
      </span>
    </div>
  );
}
