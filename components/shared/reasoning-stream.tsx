import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Model reasoning block. Clearly labelled as the model's summary (docs/01 §4.4).
 * `streaming` shows a caret + polite live region; in replay it's static text.
 */
export function ReasoningStream({
  text,
  streaming = false,
  className,
}: {
  text?: string;
  streaming?: boolean;
  className?: string;
}) {
  if (!text && !streaming) return null;
  return (
    <section className={cn("rounded-md border border-border bg-surface-2/60 p-3", className)} aria-label="Agent reasoning">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Brain className="size-3.5" aria-hidden="true" />
        Reasoning
        <span className="font-normal normal-case opacity-70">· model summary</span>
      </div>
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap text-foreground"
        aria-live={streaming ? "polite" : undefined}
      >
        {text}
        {streaming ? <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-running align-middle" aria-hidden="true" /> : null}
      </p>
    </section>
  );
}
