/**
 * Display formatters. All money is handled in cents; all numbers render with
 * tabular figures upstream (see globals.css .tabular).
 */
import type { Money, TokenUsage } from "@/types/domain";

export function formatMoney(money: Money | undefined | null): string {
  if (!money) return "—";
  const amount = money.amountCents / 100;
  const fractionDigits = amount !== 0 && Math.abs(amount) < 1 ? 3 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

export function formatTokens(tokens: TokenUsage | number | undefined | null): string {
  if (tokens == null) return "—";
  const total = typeof tokens === "number" ? tokens : tokens.total;
  return formatCompactNumber(total);
}

export function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Human duration from milliseconds: 820ms · 4.2s · 1m9s · 2h3m. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return rem ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

/** Stopwatch style for live timers: 00:38 · 01:02:09. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

/** "2m ago", "3h ago" — accepts ISO string, Date, or epoch ms. */
export function formatRelativeTime(input: string | number | Date, now: number = Date.now()): string {
  const ts = input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(input);
  if (Number.isNaN(ts)) return "—";
  const diff = ts - now;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
  for (const [unit, msPerUnit] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= msPerUnit || unit === "second") {
      return rtf.format(Math.round(diff / msPerUnit), unit);
    }
  }
  return "now";
}
