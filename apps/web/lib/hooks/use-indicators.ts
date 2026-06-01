"use client";

/**
 * Live header indicators (active runs, pending approvals).
 * P0 stub returning zeros — this is the single integration point that P2 wires
 * to the realtime channel (runStream / approvals tray). Keep the shape stable.
 */
export interface Indicators {
  activeRuns: number;
  approvals: number;
}

export function useIndicators(): Indicators {
  return { activeRuns: 0, approvals: 0 };
}
