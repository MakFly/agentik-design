"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible, copyable JSON for tool-call request/response. Renders untrusted
 * data as text only — never dangerouslySetInnerHTML (docs/03 §7.9).
 */
export function JsonViewer({ value, className, label }: { value: unknown; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const text = safeStringify(value);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className={cn("group relative rounded-md border border-border bg-surface-2", className)}>
      {label ? <div className="border-b border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{label}</div> : null}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy JSON"
        className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-3 focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground">
        {text}
      </pre>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
