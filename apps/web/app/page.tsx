import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  Clock,
  Cpu,
  Download,
  Inbox,
  LayoutGrid,
  Settings,
  Sparkles,
  SquarePen,
  Wrench,
} from "lucide-react";
import { FeatureShowcase, Faq } from "@/components/landing/multica-features";

export const metadata: Metadata = {
  title: "Multica — Project Management for Human + Agent Teams",
  description:
    "Multica is an open-source platform that turns coding agents into real teammates. Assign tasks, track progress, compound skills — manage your human + agent workforce in one place.",
};

const NAV_LINKS = [
  { href: "/use-cases", label: "Use cases" },
  { href: "/docs", label: "Docs" },
  { href: "/changelog", label: "Changelog" },
];

const WORKS_WITH = ["Claude Code", "Codex", "Gemini CLI", "OpenClaw", "OpenCode"];

const STEPS = [
  {
    n: "01",
    title: "Sign up & create your workspace",
    body: "Enter your email, verify with a code, and you’re in. Your workspace is created automatically — no setup wizard, no configuration forms.",
  },
  {
    n: "02",
    title: "Install the CLI & connect your machine",
    body: "Run multica setup — it walks you through OAuth, starts the daemon, and scans for the 12 supported coding tools on your machine.",
  },
  {
    n: "03",
    title: "Create your first agent",
    body: "Give it a name, write instructions, and attach skills. Agents automatically activate on assignment, on comment, or on mention.",
  },
  {
    n: "04",
    title: "Assign an issue and watch it work",
    body: "Pick your agent from the assignee dropdown — just like assigning to a teammate. The task is queued, claimed, and executed automatically. Watch progress in real time.",
  },
];

const SIDEBAR = [
  { icon: Inbox, label: "Inbox" },
  { icon: SquarePen, label: "My Issues" },
  { icon: LayoutGrid, label: "Issues", active: true },
  { icon: Bot, label: "Agents" },
  { icon: Cpu, label: "Runtimes" },
  { icon: Wrench, label: "Skills" },
  { icon: Settings, label: "Settings" },
];

const COLUMNS = [
  {
    name: "Backlog",
    count: 4,
    icon: Circle,
    cards: [
      { id: "MUL-17", title: "Evaluate Redis for caching layer", prio: "Low", prioColor: "amber" },
      { id: "MUL-21", title: "Add audit log export to CSV", prio: "Low", prioColor: "amber" },
    ],
  },
  {
    name: "Todo",
    count: 5,
    icon: Circle,
    cards: [
      { id: "MUL-12", title: "Add end-to-end encryption for messages", prio: "High", prioColor: "red" },
      { id: "MUL-15", title: "Create analytics dashboard for workspace activity", prio: "Medium", prioColor: "amber" },
    ],
  },
  {
    name: "In Progress",
    count: 3,
    icon: Clock,
    cards: [
      { id: "MUL-09", title: "Build WebSocket notification system", prio: "High", prioColor: "red", avatar: true },
      { id: "MUL-18", title: "Integrate Stripe billing and subscriptions", prio: "Medium", prioColor: "amber", avatar: true },
    ],
  },
  {
    name: "In Review",
    count: 2,
    icon: CheckCircle2,
    cards: [{ id: "MUL-06", title: "Add real-time editing for documents", prio: "Medium", prioColor: "amber", avatar: true }],
  },
];

const prioStyles: Record<string, string> = {
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
};

function Logo({ className = "", serif = false }: { className?: string; serif?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <Sparkles className="size-4" strokeWidth={2.25} />
      <span
        className={`text-[20px] font-semibold lowercase tracking-[0.8px] ${serif ? "mul-display !text-[28px] tracking-0" : ""}`}
      >
        multica
      </span>
    </span>
  );
}

function HeroBoard() {
  return (
    <div className="flex h-full w-full bg-[#fbfbfc]">
      {/* Sidebar */}
      <aside className="hidden w-[200px] shrink-0 flex-col border-r border-[var(--mul-line)] bg-[#f9fafb] p-3 lg:flex">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--mul-ink)]">
            <span className="flex size-4 items-center justify-center rounded bg-[var(--mul-ink)] text-white">
              <Sparkles className="size-2.5" />
            </span>
            Multica Demo
          </div>
          <SquarePen className="size-3.5 text-[var(--mul-muted)]" />
        </div>
        <nav className="mt-3 space-y-0.5">
          {SIDEBAR.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                item.active ? "bg-[var(--mul-line-2)] font-medium text-[var(--mul-ink)]" : "text-[var(--mul-muted)]"
              }`}
            >
              <item.icon className="size-4" />
              {item.label}
            </div>
          ))}
        </nav>
      </aside>

      {/* Board */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--mul-line)] px-5 py-3">
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--mul-muted)]">
            <span>Multica Demo</span>
            <span>›</span>
            <span className="text-[var(--mul-ink)]">Issues</span>
          </div>
          <div className="flex items-center gap-1 text-[12px]">
            <span className="rounded-md border border-[var(--mul-line)] bg-white px-2 py-1 font-medium text-[var(--mul-ink)]">
              Board
            </span>
            <span className="px-2 py-1 text-[var(--mul-muted)]">Filter</span>
            <span className="px-2 py-1 text-[var(--mul-muted)]">Display</span>
          </div>
        </div>

        <div className="flex flex-1 gap-3 overflow-hidden p-4">
          {COLUMNS.map((col) => (
            <div key={col.name} className="flex w-[190px] shrink-0 flex-col">
              <div className="flex items-center gap-1.5 px-1 py-1.5 text-[12px] font-semibold text-[var(--mul-ink)]">
                <col.icon className="size-3.5 text-[var(--mul-muted)]" />
                {col.name}
                <span className="text-[var(--mul-muted)]">{col.count}</span>
              </div>
              <div className="mt-1 space-y-2">
                {col.cards.map((c) => (
                  <div key={c.id} className="rounded-lg border border-[var(--mul-line)] bg-white p-2.5 shadow-sm">
                    <div className="text-[10px] text-[var(--mul-muted)]">{c.id}</div>
                    <div className="mt-0.5 text-[12px] font-medium leading-snug text-[var(--mul-ink)]">{c.title}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${prioStyles[c.prioColor]}`}>
                        {c.prio}
                      </span>
                      {"avatar" in c && c.avatar && (
                        <span className="flex size-4 items-center justify-center rounded-full bg-amber-500 text-[8px] font-semibold text-white">
                          AR
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GithubIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.41-1.27.74-1.56-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.42.36.79 1.08.79 2.18v3.23c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function DiscordIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.371-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.245.198.372.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.077.077 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="mul-landing min-h-dvh bg-white text-[var(--mul-ink)]">
      {/* ============ Hero ============ */}
      <section className="relative w-full overflow-hidden">
        <Image src="/landing/landing-bg.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20" />

        <header className="absolute inset-x-0 top-0 z-30">
          <nav className="mx-auto flex h-[76px] w-full max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex shrink-0 items-center gap-3 text-white" aria-label="multica home">
                <Logo />
              </Link>
              <div className="hidden items-center gap-1 md:flex">
                {NAV_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="inline-flex h-9 items-center rounded-[9px] px-3 text-[13px] font-medium text-white/72 transition-colors hover:text-white"
                    style={{ color: "oklab(0.999994 0.0000455678 0.0000200868 / 0.72)" }}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="https://github.com/multica/multica"
                className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[11px] border border-white/18 bg-black/16 px-4 text-[13px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/24"
              >
                <GithubIcon className="size-4" />
                <span className="hidden sm:inline">GitHub</span>
                <span className="hidden sm:inline text-white/70">38.1k</span>
              </Link>
              <Link
                href="/login"
                className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[11px] bg-white px-4 text-[13px] font-semibold text-[#0a0d12] transition-colors hover:bg-white/92"
              >
                Get started
              </Link>
            </div>
          </nav>
        </header>

        <div className="relative mx-auto flex w-full max-w-[1320px] flex-col items-center px-4 pb-24 pt-36 text-center sm:px-6 sm:pt-40 lg:px-8 lg:pb-32 lg:pt-44">
          <h1 className="mul-display max-w-[1120px] text-balance text-white [font-size:clamp(3rem,8vw,6.4rem)] [line-height:0.96]">
            Your next 10 hires won’t be human.
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-pretty text-[17px] leading-[1.5] text-white/80">
            Multica is an open-source platform that turns coding agents into real teammates. Assign tasks, track
            progress, compound skills — manage your human + agent workforce in one place.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex h-[45px] items-center justify-center gap-2 rounded-[12px] bg-white px-5 text-[14px] font-semibold text-[#0a0d12] transition-colors hover:bg-white/92"
            >
              Start free trial
            </Link>
            <Link
              href="/download"
              className="inline-flex h-[45px] items-center justify-center gap-2 rounded-[12px] border border-white/18 bg-black/16 px-5 text-[14px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/24"
            >
              <Download className="size-4" />
              Download Desktop
            </Link>
            <Link
              href="/contact-sales"
              className="group inline-flex h-[45px] items-center justify-center gap-1.5 px-3 text-[14px] font-semibold text-white/80 transition-colors hover:text-white"
            >
              Talk to sales
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[15px]">
            <span className="text-white/50">Works with</span>
            {WORKS_WITH.map((w) => (
              <span key={w} className="flex items-center gap-1.5 font-medium text-white/80">
                <Sparkles className="size-3.5 text-white/60" />
                {w}
              </span>
            ))}
          </div>
        </div>

        {/* App preview — real UI board, overlapping the hero */}
        <div className="relative z-10 mx-auto w-full max-w-[1280px] px-4 pb-2 sm:px-6 lg:px-8">
          <div className="relative aspect-[1254/846] w-full overflow-hidden border border-white/14 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.55)]">
            <HeroBoard />
          </div>
        </div>
      </section>

      {/* ============ Feature showcase (tabs) ============ */}
      <section className="bg-white text-[var(--mul-ink)]">
        <FeatureShowcase />
      </section>

      {/* ============ Dark steps ============ */}
      <section className="bg-[var(--mul-dark)] py-24 text-white lg:py-32">
        <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-white/40">Get started</p>
          <h2 className="mul-display mt-3 max-w-3xl text-[clamp(2.5rem,5vw,4.5rem)] text-white">
            Hire your first AI employee{" "}
            <span className="text-white/30">in the next hour.</span>
          </h2>

          <div className="mt-12 grid grid-cols-1 overflow-hidden rounded-2xl border border-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="border-b border-white/10 p-7 sm:border-r last:border-r-0 sm:[&:nth-child(2n)]:border-r-0 lg:border-r lg:[&:nth-child(2n)]:border-r">
                <span className="mul-mono text-[12px] text-white/40">{s.n}</span>
                <h3 className="mt-4 text-[16px] font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-[1.6] text-white/55">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ Open source ============ */}
      <section className="bg-white py-24 text-[var(--mul-ink)] lg:py-32">
        <div className="mx-auto grid w-full max-w-[1320px] grid-cols-1 gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--mul-muted)]">Open source</p>
            <h2 className="mul-display mt-3 text-[clamp(2.25rem,4.5vw,3.75rem)] text-[var(--mul-ink)]">
              Open source for all.
            </h2>
            <p className="mt-5 max-w-md text-[17px] leading-[1.55] text-[var(--mul-muted)]">
              Multica is fully open source. Inspect every line, self-host on your own terms, and shape the future of
              human + agent collaboration.
            </p>
            <Link
              href="https://github.com/multica/multica"
              className="mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--mul-ink)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-black/85"
            >
              <GithubIcon className="size-4" />
              Star on GitHub
            </Link>
          </div>

          <div className="rounded-2xl border border-[var(--mul-line)] bg-white p-2 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.2)]">
            {[
              { title: "Self-host anywhere", body: "Run Multica on your own infrastructure. Docker Compose, single binary, or Kubernetes — your data never leaves your network." },
              { title: "No vendor lock-in", body: "Bring your own LLM provider, swap agent backends, extend the API. You own the stack, top to bottom." },
              { title: "Transparent by default", body: "Every line of code is auditable. See exactly how your agents make decisions, how tasks are routed, and where your data flows." },
              { title: "Community-driven", body: "Built with the community, not just for it. Contribute skills, integrations, and agent backends that benefit everyone." },
            ].map((f, i, arr) => (
              <div key={f.title} className={`p-6 ${i < arr.length - 1 ? "border-b border-[var(--mul-line)]" : ""}`}>
                <h3 className="text-[16px] font-semibold text-[var(--mul-ink)]">{f.title}</h3>
                <p className="mt-1.5 text-[14px] leading-[1.6] text-[var(--mul-muted)]">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <Faq />

      {/* ============ Footer ============ */}
      <footer className="bg-[var(--mul-dark-ink)] text-white">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
            <div className="col-span-2">
              <Logo />
              <p className="mt-4 max-w-xs text-[14px] leading-[1.6] text-white/55">
                Project management for human + agent teams. Open source, self-hostable, built for the future of work.
              </p>
              <div className="mt-5 flex items-center gap-3">
                <Link href="https://x.com/multica" className="text-white/55 transition-colors hover:text-white">
                  <XIcon className="size-4" />
                </Link>
                <Link href="https://github.com/multica/multica" className="text-white/55 transition-colors hover:text-white">
                  <GithubIcon className="size-4" />
                </Link>
                <Link href="https://discord.gg/multica" className="text-white/55 transition-colors hover:text-white">
                  <DiscordIcon className="size-4" />
                </Link>
              </div>
              <Link
                href="/login"
                className="mt-6 inline-flex h-10 items-center rounded-full bg-white px-5 text-[13px] font-semibold text-[var(--mul-ink)] transition-colors hover:bg-white/90"
              >
                Get started
              </Link>
            </div>

            {[
              { title: "Product", links: ["Features", "How it Works", "Use cases", "Changelog", "Download"] },
              { title: "Resources", links: ["Documentation", "API", "X (Twitter)", "Discord"] },
              { title: "Company", links: ["About", "Open Source", "Contact Sales", "GitHub"] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">{col.title}</h4>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l}>
                      <Link href="#" className="text-[14px] text-white/55 transition-colors hover:text-white">
                        {l}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-14 border-t border-white/10 pt-6">
            <p className="text-[13px] text-white/40">© 2026 Multica. All rights reserved.</p>
          </div>
        </div>

        <div className="select-none overflow-hidden px-4 pb-8 sm:px-6 lg:px-8">
          <div className="mul-display flex items-center gap-4 text-white/[0.04] [font-size:clamp(4rem,18vw,16rem)] leading-none">
            <Sparkles className="size-[0.8em]" strokeWidth={1} />
            multica
          </div>
        </div>
      </footer>
    </div>
  );
}
