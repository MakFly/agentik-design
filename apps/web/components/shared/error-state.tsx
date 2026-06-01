"use client";

import { AlertTriangle, RefreshCw, ShieldX, SearchX, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toAppError, type AppErrorKind } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

const KIND_ICON: Partial<Record<AppErrorKind, LucideIcon>> = {
  forbidden: ShieldX,
  not_found: SearchX,
  network: WifiOff,
};

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  /** compact inline variant (no border/padding block) */
  inline?: boolean;
}

/**
 * Recovery-oriented error surface. Branches on the normalized AppError kind and
 * always exposes the traceId for support (docs/03 §7.6).
 */
export function ErrorState({ error, onRetry, className, inline = false }: ErrorStateProps) {
  const e = toAppError(error);
  const Icon = KIND_ICON[e.kind] ?? AlertTriangle;
  const showRetry = (e.retryable || Boolean(onRetry)) && Boolean(onRetry);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        inline ? "gap-2 py-4" : "rounded-lg border border-danger/30 bg-danger-surface/40 px-6 py-10",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{e.message}</p>
      {e.detail ? <p className="mt-1 max-w-md text-xs text-muted-foreground">{e.detail}</p> : null}
      {e.traceId ? (
        <p className="mt-2 font-mono text-[11px] text-subtle-foreground" data-tabular>
          trace {e.traceId}
        </p>
      ) : null}
      {showRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
