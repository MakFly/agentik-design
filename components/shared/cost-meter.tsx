import type { Money, TokenUsage } from "@/types/domain";
import { formatMoney, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CostMeterProps {
  spent: Money;
  cap?: Money | null;
  tokens?: TokenUsage;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Tokens/$ vs cap (docs/02 §5.2). Bar turns amber past 90% and red at/over cap.
 */
export function CostMeter({ spent, cap, tokens, size = "md", className }: CostMeterProps) {
  const ratio = cap && cap.amountCents > 0 ? spent.amountCents / cap.amountCents : null;
  const pct = ratio == null ? null : Math.min(100, Math.round(ratio * 100));

  const barTone =
    ratio == null
      ? "bg-primary"
      : ratio >= 1
        ? "bg-danger"
        : ratio >= 0.9
          ? "bg-warning"
          : "bg-primary";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold tabular-nums" data-tabular>
          {formatMoney(spent)}
        </span>
        {cap ? (
          <span className="text-xs text-muted-foreground tabular-nums" data-tabular>
            of {formatMoney(cap)}
            {pct != null ? ` · ${pct}%` : ""}
          </span>
        ) : null}
      </div>

      {cap ? (
        <div
          className={cn("w-full overflow-hidden rounded-full bg-surface-2", size === "sm" ? "h-1" : "h-1.5")}
          role="progressbar"
          aria-valuenow={pct ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Cost vs cap"
        >
          <div className={cn("h-full rounded-full transition-[width]", barTone)} style={{ width: `${pct ?? 0}%` }} />
        </div>
      ) : null}

      {tokens ? (
        <span className="text-xs text-muted-foreground tabular-nums" data-tabular>
          {formatTokens(tokens.input)} in · {formatTokens(tokens.output)} out
        </span>
      ) : null}
    </div>
  );
}
