"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/stores/session.store";

/**
 * Gates the authenticated app shell on a real session (hydrated from the engine).
 * While unhydrated it shows a lightweight loader; with no session it redirects to
 * /login; if the URL team isn't the resolved active org it bounces to the right
 * slug. Children render only when a non-null session matches the URL — so every
 * consumer below can treat the session as present.
 */
export function SessionGuard({ team, children }: { team: string; children: ReactNode }) {
  const hydrated = useSessionStore((s) => s.hydrated);
  const session = useSessionStore((s) => s.session);
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    if (!session) {
      router.replace("/login");
    } else if (session.team.slug !== team) {
      router.replace(`/${session.team.slug}/chat`);
    }
  }, [hydrated, session, team, router]);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground" role="status" aria-live="polite">
        Loading your workspace…
      </div>
    );
  }
  if (!session || session.team.slug !== team) return null;
  return <>{children}</>;
}
