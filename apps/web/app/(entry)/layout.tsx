import type { ReactNode } from "react";
import Link from "next/link";

/** Centered, Apple-font shell for the sign-up / sign-in / verify / onboarding funnel. */
export default function EntryLayout({ children }: { children: ReactNode }) {
  return (
    <div className="font-apple flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-[var(--navbar-h)] items-center px-[max(1.25rem,env(safe-area-inset-left))]">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Agentik
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
