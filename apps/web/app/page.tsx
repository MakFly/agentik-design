import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Agentik — control plane for AI agents",
  description:
    "Author an agent, run it on isolated runtimes, watch it live, approve risky actions — then review the run and let it improve future runs through versioned memory & skills.",
};

const LOOP = [
  {
    step: "01",
    title: "Run",
    body: "Publish an immutable agent version and run it on a real daemon runtime. Watch reasoning, tool calls, and cost stream live.",
  },
  {
    step: "02",
    title: "Review",
    body: "When a run finishes, a review agent proposes memory and skill changes. Nothing is applied until a human approves it.",
  },
  {
    step: "03",
    title: "Learn",
    body: "Approved changes become versioned memory and skills — and are injected into the agent's next run. The loop compounds.",
  },
];

export default function LandingPage() {
  return (
    <div className="font-apple flex min-h-dvh flex-col bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <nav className="mx-auto flex h-[var(--navbar-h)] w-full max-w-6xl items-center justify-between px-[max(1rem,env(safe-area-inset-left))]">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Agentik
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" className="min-h-11">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild className="min-h-11">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-[max(1.25rem,env(safe-area-inset-left))] pb-16 pt-16 sm:pt-24 lg:pt-32">
          <p className="mb-4 text-sm font-medium tracking-tight text-primary">The control plane for AI agents</p>
          <h1 className="max-w-4xl text-balance font-semibold leading-[1.05] tracking-tight text-[clamp(2.5rem,6vw,4.75rem)]">
            Ship agents that get better every run.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-[clamp(1.05rem,2.2vw,1.375rem)] leading-relaxed text-muted-foreground">
            Author an agent, run it on isolated runtimes, and watch it live. When the run ends, review what it
            learned — approved memory and skills flow into the next run. That feedback loop is the product.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-h-12 text-base">
              <Link href="/signup">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-h-12 text-base">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </section>

        {/* The loop */}
        <section className="border-t border-border/60 bg-surface-2/40">
          <div className="mx-auto w-full max-w-6xl px-[max(1.25rem,env(safe-area-inset-left))] py-16 sm:py-20">
            <h2 className="text-balance font-semibold tracking-tight text-[clamp(1.75rem,3.5vw,2.5rem)]">
              Run. Review. Learn.
            </h2>
            <p className="mt-3 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
              A single agent control loop — not workflow orchestration. Everything exists to make that loop real,
              end to end.
            </p>
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {LOOP.map((c) => (
                <li
                  key={c.step}
                  className="rounded-xl border border-border bg-surface p-6 transition-colors hover:border-border-strong"
                >
                  <span className="font-mono text-sm text-subtle-foreground">{c.step}</span>
                  <h3 className="mt-3 text-xl font-semibold tracking-tight">{c.title}</h3>
                  <p className="mt-2 text-pretty text-[0.975rem] leading-relaxed text-muted-foreground">{c.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-6xl px-[max(1.25rem,env(safe-area-inset-left))] py-20 sm:py-28">
          <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center sm:px-12 sm:py-16">
            <h2 className="text-balance font-semibold tracking-tight text-[clamp(1.75rem,4vw,3rem)]">
              Make your next run smarter than your last.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
              Create an organization, connect a daemon, and launch your first agent in minutes.
            </p>
            <Button asChild size="lg" className="mt-8 min-h-12 text-base">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-[max(1.25rem,env(safe-area-inset-left))] py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© 2026 Agentik</span>
          <span className="tracking-tight">A production control plane for autonomous agents.</span>
        </div>
      </footer>
    </div>
  );
}
