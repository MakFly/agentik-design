"use client";

import { useEffect, useState, type ReactNode } from "react";

// Real engine by default. The mock is opt-in: set NEXT_PUBLIC_USE_MOCK=true.
const ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_MOCK === "true";

/**
 * Starts the MSW browser worker only when explicitly opted in
 * (NEXT_PUBLIC_USE_MOCK=true). Otherwise requests proxy straight to the engine.
 */
export function MswReady({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!ENABLED);

  useEffect(() => {
    if (!ENABLED) return;
    let active = true;
    import("@/mocks/browser")
      .then(({ worker }) => worker.start({ onUnhandledRequest: "bypass", quiet: true }))
      .then(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
