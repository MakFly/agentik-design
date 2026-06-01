"use client";

import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import type { ToolCall } from "@/types/domain";
import { StatusBadge } from "./status-badge";
import { JsonViewer } from "./json-viewer";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Expandable tool-call record: action, status, latency, request/response, error. */
export function ToolCallRecord({ call, defaultOpen = false }: { call: ToolCall; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const statusForBadge = call.status === "running" ? "running" : call.status === "failed" ? "failed" : "succeeded";

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-2"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true" />
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{call.action}</span>
        <StatusBadge status={statusForBadge} size="sm" />
        {call.latencyMs != null ? (
          <span className="text-[11px] text-muted-foreground tabular-nums" data-tabular>
            {formatDuration(call.latencyMs)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border p-2.5">
          <JsonViewer value={call.request} label="Request" />
          {call.error ? (
            <div className="rounded-md border border-danger/30 bg-danger-surface/40 p-2.5 text-xs">
              <span className="font-mono font-medium text-danger">{call.error.code}</span>
              <p className="mt-0.5 text-foreground">{call.error.message}</p>
            </div>
          ) : call.response !== undefined ? (
            <JsonViewer value={call.response} label={call.httpStatus ? `Response · ${call.httpStatus}` : "Response"} />
          ) : (
            <p className="text-xs text-muted-foreground">Awaiting response…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
