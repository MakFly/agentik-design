import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Agentik — control plane for AI agents",
  description:
    "Author an agent, run it on isolated runtimes, watch it live, approve risky actions — then review the run and let it improve future runs through versioned memory & skills.",
};

const LOOP = [
  {
    step: "01",
    title: "Run",
    body: "Publish an immutable agent version and run it on a real daemon runtime. Reasoning, tool calls, and cost stream live.",
  },
  {
    step: "02",
    title: "Review",
    body: "When a run finishes, a review agent proposes memory and skill changes. Nothing is applied until you approve it.",
  },
  {
    step: "03",
    title: "Learn",
    body: "Approved changes become versioned memory and skills — injected into the agent's next run. The loop compounds.",
  },
];

/** Apple-blue pill — primary call to action. */
function PrimaryCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      {children}
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="theme-apple font-apple flex min-h-dvh flex-col bg-[var(--bg)] text-[color:var(--ink)] antialiased">
      {/* Navbar — thin, translucent, Apple global-nav style */}
      <header className="sticky top-0 z-30 border-b border-[color:var(--line)]/70 bg-[var(--bg)]/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-[var(--navbar-h)] w-full max-w-6xl items-center justify-between px-[max(1.25rem,env(safe-area-inset-left))]">
          <Link href="/" className="text-[17px] font-semibold tracking-[-0.01em]" aria-label="Agentik home">
            Agentik
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center px-2 text-[14px] text-[color:var(--ink-2)] transition-colors hover:text-[color:var(--ink)]"
            >
              Sign in
            </Link>
            <PrimaryCta href="/signup">Start free</PrimaryCta>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero — centered, oversized SF headline, single accent keyword */}
        <section className="mx-auto w-full max-w-5xl px-[max(1.25rem,env(safe-area-inset-left))] pb-20 pt-20 text-center sm:pt-28 lg:pt-36">
          <p className="apple-reveal text-[15px] font-medium tracking-[-0.01em] text-[color:var(--accent)]">
            The control plane for AI agents
          </p>
          <h1 className="apple-reveal mx-auto mt-4 max-w-4xl text-balance font-semibold leading-[1.05] tracking-[-0.025em] text-[clamp(2.75rem,7vw,5.25rem)] [animation-delay:80ms]">
            Ship agents that get{" "}
            <span className="bg-gradient-to-r from-[var(--accent)] to-[#5ac8fa] bg-clip-text text-transparent">
              better
            </span>{" "}
            every run.
          </h1>
          <p className="apple-reveal mx-auto mt-6 max-w-2xl text-pretty text-[clamp(1.125rem,2.2vw,1.5rem)] leading-[1.4] text-[color:var(--ink-2)] [animation-delay:160ms]">
            Author an agent, run it on isolated runtimes, and watch it live. When the run ends, review what it
            learned — approved memory and skills flow into the next run.
          </p>
          <div className="apple-reveal mt-9 flex flex-col items-center justify-center gap-x-7 gap-y-4 sm:flex-row [animation-delay:240ms]">
            <PrimaryCta href="/signup">Start free</PrimaryCta>
            <Link
              href="/login"
              className="group inline-flex min-h-11 items-center text-[16px] font-medium text-[color:var(--accent)]"
            >
              Sign in
              <span aria-hidden className="ml-1 transition-transform group-hover:translate-x-0.5">
                ›
              </span>
            </Link>
          </div>
        </section>

        {/* The loop — a real cycle, not an icon-card row */}
        <section className="bg-[var(--bg-2)]">
          <div className="mx-auto w-full max-w-6xl px-[max(1.25rem,env(safe-area-inset-left))] py-20 sm:py-28">
            <div className="text-center">
              <h2 className="text-balance font-semibold tracking-[-0.02em] text-[clamp(2rem,4.5vw,3rem)]">
                Run. Review. Learn.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-[17px] leading-[1.5] text-[color:var(--ink-2)]">
                A single agent control loop — not workflow orchestration. Each run feeds the next.
              </p>
            </div>

            <ol className="mt-14 flex flex-col items-stretch gap-4 lg:flex-row lg:items-center lg:gap-0">
              {LOOP.map((c, i) => (
                <li key={c.step} className="contents">
                  <div className="flex-1 rounded-[28px] border border-[color:var(--line)]/70 bg-[var(--bg)] p-7 sm:p-8">
                    <span className="font-mono text-[13px] tracking-widest text-[color:var(--ink-2)]">
                      STEP {c.step}
                    </span>
                    <h3 className="mt-4 text-[1.6rem] font-semibold tracking-[-0.02em]">{c.title}</h3>
                    <p className="mt-2 text-pretty text-[15px] leading-[1.55] text-[color:var(--ink-2)]">{c.body}</p>
                  </div>
                  {/* connector between steps only; the loop-back is stated in the caption below */}
                  {i < LOOP.length - 1 && (
                    <span
                      aria-hidden
                      className="flex shrink-0 items-center justify-center self-center text-2xl text-[color:var(--accent)] lg:px-3"
                    >
                      <span className="lg:hidden">↓</span>
                      <span className="hidden lg:inline">→</span>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-6 text-center text-[14px] text-[color:var(--ink-2)]">
              <span aria-hidden className="text-[color:var(--accent)]">
                ↺
              </span>{" "}
              Every approved lesson is injected into the agent&apos;s next run.
            </p>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-4xl px-[max(1.25rem,env(safe-area-inset-left))] py-24 text-center sm:py-32">
          <h2 className="text-balance font-semibold tracking-[-0.025em] text-[clamp(2rem,5vw,3.5rem)]">
            Make your next run smarter than your last.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[clamp(1.0625rem,2vw,1.375rem)] leading-[1.45] text-[color:var(--ink-2)]">
            Create an organization, connect a daemon, and launch your first agent in minutes.
          </p>
          <div className="mt-9 flex justify-center">
            <PrimaryCta href="/signup">Start free</PrimaryCta>
          </div>
        </section>
      </main>

      <footer className="border-t border-[color:var(--line)]/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-[max(1.25rem,env(safe-area-inset-left))] py-8 text-[13px] text-[color:var(--ink-2)] sm:flex-row">
          <span>© 2026 Agentik</span>
          <span className="tracking-[-0.01em]">A production control plane for autonomous agents.</span>
        </div>
      </footer>
    </div>
  );
}
