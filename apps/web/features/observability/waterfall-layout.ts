import type { Span } from "@/types/observability";

export interface WaterfallRow {
  span: Span;
  depth: number;
  hasChildren: boolean;
}

/**
 * Flatten the span tree into DFS pre-order rows (parent immediately above its
 * children, siblings by start time) with a depth for indentation. Orphan spans
 * (parent missing from the set) are treated as roots so nothing is dropped.
 */
export function buildWaterfallRows(spans: Span[]): WaterfallRow[] {
  const byParent = new Map<string | null, Span[]>();
  for (const s of spans) {
    const arr = byParent.get(s.parentSpanId) ?? [];
    arr.push(s);
    byParent.set(s.parentSpanId, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.startOffsetMs - b.startOffsetMs);

  const ids = new Set(spans.map((s) => s.spanId));
  const rows: WaterfallRow[] = [];

  const walk = (span: Span, depth: number) => {
    const kids = byParent.get(span.spanId) ?? [];
    rows.push({ span, depth, hasChildren: kids.length > 0 });
    for (const k of kids) walk(k, depth + 1);
  };

  const roots = spans
    .filter((s) => s.parentSpanId === null || !ids.has(s.parentSpanId))
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  for (const r of roots) walk(r, 0);

  return rows;
}

/** Evenly spaced tick offsets (ms) for the time ruler, including 0 and total. */
export function rulerTicks(totalMs: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round((totalMs / count) * i));
}
