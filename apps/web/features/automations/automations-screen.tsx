"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShortId } from "@/lib/format";
import { SignalsList } from "./signals-list";
import { RulesList } from "./rules-list";
import { DeliveriesTable } from "./deliveries-table";

export function AutomationsScreen({ team }: { team: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Automations" description="Signals fire rules that orchestrate or run agents." />
      {/* useSearchParams must live under a Suspense boundary (Next.js App Router). */}
      <Suspense fallback={<Skeleton className="h-64 rounded-lg" />}>
        <AutomationsTabs team={team} />
      </Suspense>
    </div>
  );
}

function AutomationsTabs({ team }: { team: string }) {
  const params = useSearchParams();
  const agentId = params.get("agent") ?? undefined;
  const [tab, setTab] = useState(agentId ? "rules" : "signals");

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <TabsList className="w-full max-w-md">
        <TabsTrigger value="signals">Signals</TabsTrigger>
        <TabsTrigger value="rules">Rules</TabsTrigger>
        <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
      </TabsList>

      <TabsContent value="signals">
        <SignalsList team={team} />
      </TabsContent>

      <TabsContent value="rules" className="flex flex-col gap-3">
        {agentId ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              Filtered to agent {formatShortId(agentId)}
            </Badge>
            <Link href={`/${team}/automations`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X className="size-3.5" /> Clear filter
            </Link>
          </div>
        ) : null}
        <RulesList team={team} agentId={agentId} />
      </TabsContent>

      <TabsContent value="deliveries">
        <DeliveriesTable team={team} />
      </TabsContent>
    </Tabs>
  );
}
