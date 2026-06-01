"use client";

import { useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { promptVariables, estimateTokens } from "./validation";
import { cn } from "@/lib/utils";

/**
 * System-prompt editor. A mono textarea with a live token count and detected
 * `{{variables}}`. The component boundary is deliberately small so a CodeMirror/
 * Monaco swap (syntax highlight of `{{...}}`) is a drop-in later (docs/01 §4.2).
 */
export function PromptEditor({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const vars = useMemo(() => promptVariables(value), [value]);
  const tokens = useMemo(() => estimateTokens(value), [value]);

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        aria-label="System prompt"
        spellCheck={false}
        className={cn("min-h-56 resize-y font-mono text-[13px] leading-relaxed")}
        placeholder="You are a…"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums" data-tabular>
          ~{tokens} tokens
        </span>
        <span className="flex items-center gap-1.5">
          variables:
          {vars.length ? (
            vars.map((v) => (
              <code key={v} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-accent-foreground">
                {`{{${v}}}`}
              </code>
            ))
          ) : (
            <span>none</span>
          )}
        </span>
      </div>
    </div>
  );
}
