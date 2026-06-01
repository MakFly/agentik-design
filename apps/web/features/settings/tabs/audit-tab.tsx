"use client";

import { useState } from "react";
import { Search, ShieldAlert, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { useAuditLog } from "../api";
import { cn } from "@/lib/utils";

export function AuditTab({ team }: { team: string }) {
  const [q, setQ] = useState("");
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const { data, isLoading, isError, error, refetch } = useAuditLog(team, {
    q: q.trim() || undefined,
    suspicious: suspiciousOnly || undefined,
  });
  const items = data?.items ?? [];

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actor, action, target…" className="pl-9" aria-label="Search audit log" />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={suspiciousOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setSuspiciousOnly((v) => !v)}
            aria-pressed={suspiciousOnly}
          >
            <ShieldAlert className="size-4" /> Suspicious
          </Button>
          <Button type="button" variant="outline" size="sm">
            <Download className="size-4" /> Export
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Search} title="No matching events" description="Adjust your search or clear the suspicious-only filter." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((e) => (
            <li
              key={e.id}
              className={cn(
                "flex flex-col gap-1 rounded-lg border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                e.suspicious ? "border-danger/40 bg-danger-surface/20" : "border-border",
              )}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-xs text-primary">{e.action}</code>
                  {e.suspicious && (
                    <Badge variant="outline" className="gap-1 border-danger/40 text-[11px] text-danger">
                      <ShieldAlert className="size-3" /> suspicious
                    </Badge>
                  )}
                </div>
                <span className="truncate text-sm text-foreground">{e.target}</span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{e.actor}</span>
                <code className="font-mono">{e.ip}</code>
                <span>{formatRelativeTime(e.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
