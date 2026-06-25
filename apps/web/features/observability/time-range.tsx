"use client";

import { useQueryState } from "nuqs";
import { cn } from "@/lib/utils";

export interface PillOption {
  value: string;
  label: string;
}

/** Filter pill group — same visual language as the runs-list status filter. */
export function PillGroup({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: string;
  options: PillOption[];
  onChange: (v: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              "rounded-full border font-medium transition-colors",
              size === "sm" ? "min-h-[28px] px-2 py-0.5 text-[11px]" : "min-h-[32px] px-2.5 py-1 text-xs",
              active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const RANGES: PillOption[] = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

const ENVS: PillOption[] = [
  { value: "all", label: "All envs" },
  { value: "prod", label: "Prod" },
  { value: "staging", label: "Staging" },
  { value: "dev", label: "Dev" },
];

/** Range + environment scope for the whole observability view (URL-synced). */
export function RangeEnvBar() {
  const [range, setRange] = useQueryState("range", { defaultValue: "24h" });
  const [env, setEnv] = useQueryState("env");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PillGroup value={range} options={RANGES} onChange={(v) => setRange(v)} />
      <PillGroup value={env ?? "all"} options={ENVS} onChange={(v) => setEnv(v === "all" ? null : v)} />
    </div>
  );
}
