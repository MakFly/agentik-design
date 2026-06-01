"use client";

import { cn } from "@/lib/utils";

export interface LogLineItem {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

const LEVEL_CLASS: Record<LogLineItem["level"], string> = {
  debug: "text-subtle-foreground",
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-danger",
};

/**
 * Structured log view. P1 renders a bounded static list; the live run view feeds
 * it from the SSE log.line events (docs/03 §7.7). Virtualize when unbounded.
 */
export function LogStream({ lines, className }: { lines: LogLineItem[]; className?: string }) {
  if (!lines.length) {
    return <p className={cn("px-1 py-2 text-xs text-muted-foreground", className)}>No logs for this step.</p>;
  }
  return (
    <div className={cn("max-h-64 overflow-y-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-xs leading-relaxed", className)}>
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className="shrink-0 text-subtle-foreground tabular-nums" data-tabular>
            {l.ts}
          </span>
          <span className={cn("shrink-0 uppercase", LEVEL_CLASS[l.level])}>{l.level}</span>
          <span className="break-words text-foreground">{l.message}</span>
        </div>
      ))}
    </div>
  );
}
