import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  Workflow,
  Activity,
  Wrench,
  Database,
  FlaskConical,
  ArrowRight,
  Eye,
  Brain,
  Wrench as ToolIcon,
  AlertTriangle,
  DollarSign,
  ShieldCheck,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export const metadata: Metadata = {
  title: "Agentik — the control plane for autonomous AI agents",
  description:
    "Author, orchestrate, observe, and govern fleets of AI agents. Watch them think in real time — every decision, tool call, dollar, and failure, with the controls to pause, retry, or approve any step.",
};

const APP_HREF = "/acme/dashboard";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <LandingNav />
      <main>
        <Hero />
        <StatStrip />
        <Guarantees />
        <Features />
        <CtaBand />
      </main>
      <LandingFooter />
    </div>
  );
}

/* ─────────────────────────────── Nav ─────────────────────────────── */

function LandingNav() {
  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-surface/[0.97] backdrop-blur-sm"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-[var(--navbar-h)] w-full max-w-[1200px] items-center gap-4 px-4 sm:px-6"
      >
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo />
          <span className="text-base tracking-tight">Agentik</span>
        </Link>

        <div className="ml-auto hidden items-center gap-1 md:flex">
          <NavLink href="#features">Product</NavLink>
          <NavLink href="#guarantees">Why Agentik</NavLink>
          <NavLink href="#features">Modules</NavLink>
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-2">
          <ThemeToggle />
          <Button asChild size="sm" className="min-h-[44px] md:min-h-9">
            <Link href={APP_HREF}>
              Open dashboard <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </a>
  );
}

function Logo() {
  return (
    <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
      <Bot className="size-4" aria-hidden="true" />
    </span>
  );
}

/* ────────────────────────────── Hero ─────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* subtle radial accent, GPU-cheap (no full-screen blur) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(60%_60%_at_70%_-10%,var(--accent)_0%,transparent_70%)]"
      />
      <div className="relative mx-auto grid w-full max-w-[1200px] gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            The control plane for agentic AI
          </span>

          <h1 className="text-[clamp(2rem,1.4rem+3vw,3.5rem)] leading-[1.05] font-semibold tracking-tight text-balance">
            Build agents. Ship workflows.{" "}
            <span className="text-primary">Watch them think.</span>
          </h1>

          <p className="max-w-xl text-[clamp(1rem,0.95rem+0.4vw,1.2rem)] leading-relaxed text-muted-foreground text-pretty">
            Agentik is where teams author, orchestrate, observe, and govern fleets of AI agents — with
            full visibility into every decision, tool call, dollar, and failure, and the controls to
            pause, retry, or approve any step in real time.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-h-[44px]">
              <Link href={APP_HREF}>
                Open the dashboard <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-h-[44px]">
              <Link href="#features">Explore the platform</Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Developers · AI engineers · automation teams · product operators · DevOps
          </p>
        </div>

        <RunConsoleMock />
      </div>
    </section>
  );
}

/** Static evocation of the live Task Execution View (no client JS). */
function RunConsoleMock() {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-danger/60" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-warning/60" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-success/60" aria-hidden="true" />
        <span className="ml-2 font-mono text-xs text-muted-foreground">run_8f2 · Support Triage Flow</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-running">
          <span className="size-1.5 animate-pulse rounded-full bg-running" aria-hidden="true" />
          live
        </span>
      </div>

      <div className="grid grid-cols-1 gap-0 sm:grid-cols-[150px_1fr]">
        {/* timeline */}
        <ol className="flex flex-col gap-2 border-b border-border p-3 text-xs sm:border-r sm:border-b-0">
          <ConsoleStep dot="bg-success" label="Triage Agent" sub="$0.03 · 2.1s" />
          <ConsoleStep dot="bg-success" label="Decision" sub="→ billing" />
          <ConsoleStep dot="bg-running animate-pulse" label="Resolve Agent" sub="running…" active />
          <ConsoleStep dot="bg-info" label="Approval" sub="pending" />
          <ConsoleStep dot="bg-surface-3 ring-1 ring-border-strong" label="Stripe refund" sub="queued" muted />
        </ol>

        {/* focus */}
        <div className="flex flex-col gap-3 p-3">
          <div className="rounded-md border border-border bg-surface-2/60 p-2.5">
            <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Reasoning · model summary
            </p>
            <p className="text-xs leading-relaxed text-foreground">
              The ticket mentions a duplicate charge. I should look up the customer&apos;s recent
              transactions before deciding on a refund
              <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-running align-middle" aria-hidden="true" />
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-mono">
              <ToolIcon className="size-3.5 text-muted-foreground" aria-hidden="true" /> search_kb
            </span>
            <span className="text-running">running · 1.8s</span>
          </div>

          <div className="flex items-center justify-between rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-medium tabular-nums" data-tabular>
              $0.12 / $0.20 cap
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-full w-[60%] rounded-full bg-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ConsoleStep({
  dot,
  label,
  sub,
  active,
  muted,
}: {
  dot: string;
  label: string;
  sub: string;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <li className={`flex items-start gap-2 rounded-md px-1.5 py-1 ${active ? "bg-accent" : ""} ${muted ? "opacity-50" : ""}`}>
      <span className={`mt-1 size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{label}</span>
        <span className="block truncate text-[10px] text-muted-foreground tabular-nums" data-tabular>
          {sub}
        </span>
      </span>
    </li>
  );
}

/* ─────────────────────────── Stat strip ──────────────────────────── */

function StatStrip() {
  const stats = [
    { value: "10", label: "core modules" },
    { value: "Real-time", label: "execution streaming" },
    { value: "Per-step", label: "cost & token accounting" },
    { value: "RBAC", label: "+ audit on every action" },
  ];
  return (
    <section className="border-b border-border bg-surface-2/40">
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1 py-8 text-center">
            <span className="text-[clamp(1.5rem,1.2rem+1vw,2rem)] font-semibold tracking-tight">{s.value}</span>
            <span className="text-sm text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────── Guarantees ───────────────────────────── */

function Guarantees() {
  const items: Array<{ icon: LucideIcon; title: string; body: string }> = [
    { icon: Eye, title: "What it's doing", body: "A live timeline of every step, with the running step always in view." },
    { icon: Brain, title: "Why it decided", body: "The model's reasoning is attached to each action and the prompt version that produced it." },
    { icon: ToolIcon, title: "Which tools ran", body: "Expandable tool calls with request, response, latency, and cost." },
    { icon: AlertTriangle, title: "What failed", body: "First-class error states — the failing step, the error class, and the retry, inline." },
    { icon: DollarSign, title: "What it cost", body: "Token and dollar accounting on every run, step, agent, and team." },
    { icon: ShieldCheck, title: "What you can control", body: "Pause, resume, cancel, retry, or approve any step — gated by role." },
  ];
  return (
    <section id="guarantees" className="border-b border-border">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24">
        <SectionHeading
          eyebrow="Observability-first"
          title="You always know what your agents are doing"
          subtitle="The whole interface is built around six questions that must never be more than a glance away."
        />
        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.title} className="flex flex-col gap-2 bg-surface p-6">
              <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <it.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-1 font-semibold">{it.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────── Features ───────────────────────────── */

function Features() {
  const features: Array<{ icon: LucideIcon; title: string; body: string }> = [
    { icon: Bot, title: "Agent Builder", body: "Author role, prompt, model, tools, memory, limits, and guardrails — then test live before publishing an immutable version." },
    { icon: Workflow, title: "Workflow Builder", body: "A visual canvas to wire agents, tools, decisions, API calls, and human-approval gates into runnable graphs." },
    { icon: Activity, title: "Observability", body: "OpenTelemetry-style trace waterfalls, latency & cost metrics, a log explorer, and prompt-version attribution." },
    { icon: Wrench, title: "Tool Management", body: "Connect GitHub, Slack, Stripe, databases, or any REST endpoint with least-privilege scopes and a real test flow." },
    { icon: Database, title: "Memory & Knowledge", body: "Vector stores and RAG sources with transparent retrieval, source citations, and retention policy." },
    { icon: FlaskConical, title: "Evaluation Center", body: "Datasets, scorers, A/B compare with significance, and regression gates before you promote a version." },
  ];
  return (
    <section id="features" className="border-b border-border bg-surface-2/40">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24">
        <SectionHeading
          eyebrow="One platform"
          title="Everything it takes to run agents in production"
          subtitle="Author, orchestrate, observe, and govern — without stitching together a dozen tools."
        />
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.title}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-border-strong"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────── CTA band ───────────────────────────── */

function CtaBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-8 text-center sm:p-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(50%_80%_at_50%_0%,var(--accent)_0%,transparent_70%)]"
          />
          <div className="relative flex flex-col items-center gap-5">
            <h2 className="max-w-2xl text-[clamp(1.5rem,1.2rem+1.6vw,2.25rem)] font-semibold tracking-tight text-balance">
              See an agent reason, call tools, and report its cost — live.
            </h2>
            <p className="max-w-xl text-muted-foreground">
              Jump straight into the dashboard and open a running execution.
            </p>
            <Button asChild size="lg" className="min-h-[44px]">
              <Link href={APP_HREF}>
                Open the dashboard <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────── Footer ─────────────────────────────── */

function LandingFooter() {
  return (
    <footer className="bg-background">
      <div
        className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-4 px-4 py-10 sm:flex-row sm:px-6"
        style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Logo />
          <span className="font-medium text-foreground">Agentik</span>
          <span>· control plane for autonomous AI agents</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href={APP_HREF} className="transition-colors hover:text-foreground">
            Dashboard
          </Link>
          <a href="#features" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
            <BookOpen className="size-4" aria-hidden="true" /> Product
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────── Shared bits ─────────────────────────── */

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <span className="text-xs font-semibold tracking-wider text-primary uppercase">{eyebrow}</span>
      <h2 className="text-[clamp(1.5rem,1.2rem+1.4vw,2.25rem)] font-semibold tracking-tight text-balance">{title}</h2>
      <p className="text-[clamp(1rem,0.95rem+0.3vw,1.125rem)] leading-relaxed text-muted-foreground text-pretty">
        {subtitle}
      </p>
    </div>
  );
}
