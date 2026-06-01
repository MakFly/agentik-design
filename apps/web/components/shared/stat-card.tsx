import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatDelta {
  text: string;
  tone?: "good" | "bad" | "neutral";
  direction?: "up" | "down";
}

export interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  delta?: StatDelta;
  series?: number[];
  icon?: LucideIcon;
  href?: string;
  className?: string;
}

const DELTA_TONE: Record<NonNullable<StatDelta["tone"]>, string> = {
  good: "text-success",
  bad: "text-danger",
  neutral: "text-muted-foreground",
};

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-7 w-24 overflow-visible text-primary", className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function StatCard({ label, value, sublabel, delta, series, icon: Icon, href, className }: StatCardProps) {
  const content = (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors",
        href && "hover:border-border-strong hover:bg-surface-2",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-4 text-subtle-foreground" aria-hidden="true" /> : null}
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums" data-tabular>
          {value}
        </span>
        {series ? <Sparkline data={series} /> : null}
      </div>

      <div className="flex items-center gap-2 text-xs">
        {delta ? (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", DELTA_TONE[delta.tone ?? "neutral"])}>
            {delta.direction === "up" ? (
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            ) : delta.direction === "down" ? (
              <ArrowDownRight className="size-3.5" aria-hidden="true" />
            ) : null}
            {delta.text}
          </span>
        ) : null}
        {sublabel ? <span className="text-muted-foreground">{sublabel}</span> : null}
      </div>

      {href ? (
        <ArrowRight className="absolute top-4 right-4 size-4 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full focus-visible:outline-none">
        {content}
      </Link>
    );
  }
  return content;
}
