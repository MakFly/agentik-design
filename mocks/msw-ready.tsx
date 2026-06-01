"use client";

import { useEffect, useState, type ReactNode } from "react";

const ENABLED = process.env.NODE_ENV === "development";

/**
 * Starts the MSW browser worker in development before rendering children, so
 * queries are intercepted by the mocked contract. In production it's a no-op.
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
