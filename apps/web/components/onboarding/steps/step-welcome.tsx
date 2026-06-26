"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  FileSearch,
  Pencil,
  Sparkles,
  Star,
} from "lucide-react";

type AgentCard = {
  id: string;
  agent: string;
  ticket: string;
  message: React.ReactNode;
  status?: { label: string; tone: "progress" | "done" | "review" };
  avatar: React.ReactNode;
  offset: number;
  delay: number;
};

const CARDS: AgentCard[] = [
  {
    id: "you",
    agent: "You",
    ticket: "MCA-42",
    offset: 0,
    delay: 80,
    avatar: (
      <span className="flex size-7 items-center justify-center rounded-full bg-[#0a0d12] text-[11px] font-semibold text-white">
        N
      </span>
    ),
    message: (
      <>
        <span className="text-[var(--mul-accent)]">@Content Agent</span> can you draft a short launch post? Pull from{" "}
        <span className="text-[var(--mul-accent)]">@Research Agent</span>&apos;s interview findings.
      </>
    ),
  },
  {
    id: "content",
    agent: "Content Agent",
    ticket: "MCA-42",
    offset: 12,
    delay: 140,
    avatar: (
      <span className="flex size-7 items-center justify-center rounded-full bg-slate-200 text-slate-600">
        <Pencil className="size-3.5" />
      </span>
    ),
    message: <>On it. Pulling Research&apos;s quotes, drafting around the &quot;time saved&quot; angle…</>,
    status: { label: "In Progress", tone: "progress" },
  },
  {
    id: "research",
    agent: "Research Agent",
    ticket: "MCA-38",
    offset: 24,
    delay: 200,
    avatar: (
      <span className="flex size-7 items-center justify-center rounded-full bg-slate-100 text-slate-700">
        <FileSearch className="size-3.5" />
      </span>
    ),
    message: <>This week&apos;s user interviews summarized — 12 calls, 4 recurring themes, 3 pull-quotes.</>,
    status: { label: "Done · 15 min ago", tone: "done" },
  },
  {
    id: "review",
    agent: "Review Agent",
    ticket: "MCA-42",
    offset: 36,
    delay: 260,
    avatar: (
      <span className="flex size-7 items-center justify-center rounded-full bg-red-50 text-red-600">
        <Bot className="size-3.5" />
      </span>
    ),
    message: <>Reviewed Monday&apos;s draft — left 4 notes on tone. Standing by for the new one.</>,
    status: { label: "In Review", tone: "review" },
  },
  {
    id: "coding",
    agent: "Coding Agent",
    ticket: "MCA-35",
    offset: 48,
    delay: 320,
    avatar: (
      <span className="flex size-7 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <Star className="size-3.5" />
      </span>
    ),
    message: (
      <>
        Shipped the export feature <span className="text-[var(--mul-accent)]">@you</span> flagged. Preview link in the
        PR.
      </>
    ),
    status: { label: "Done · just now", tone: "done" },
  },
];

function StatusBadge({ status }: { status: NonNullable<AgentCard["status"]> }) {
  const icon =
    status.tone === "progress" ? (
      <Clock className="size-3 text-amber-500" />
    ) : status.tone === "review" ? (
      <CheckCircle2 className="size-3 text-emerald-500" />
    ) : (
      <CheckCircle2 className="size-3 text-blue-500" />
    );
  return (
    <div className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--mul-muted)]">
      {icon}
      <span>{status.label}</span>
    </div>
  );
}

function AgentCardView({ card }: { card: AgentCard }) {
  return (
    <article
      className="onboarding-card-enter w-full max-w-[460px] rounded-[10px] border border-[var(--mul-line)] bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)]"
      style={{ marginLeft: card.offset, animationDelay: `${card.delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {card.avatar}
          <span className="text-[13px] font-medium text-[var(--mul-ink)]">{card.agent}</span>
        </div>
        <span className="text-[11px] text-[var(--mul-muted)]">{card.ticket}</span>
      </div>
      <p className="mt-2.5 text-[14px] leading-[1.55] text-[oklch(0.141_0.005_285.823/0.85)]">{card.message}</p>
      {card.status && <StatusBadge status={card.status} />}
    </article>
  );
}

export function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="mul-landing animate-onboarding-enter flex min-h-dvh flex-col bg-white lg:flex-row">
      <div className="flex flex-col lg:w-1/2 lg:flex-1">
        <div className="flex flex-1 flex-col justify-center px-6 pb-12 pt-10 sm:px-10 md:px-16 lg:px-20 xl:px-24">
          <div className="flex items-center gap-2.5 text-[15px] text-[var(--mul-ink)]">
            <Sparkles className="size-4" strokeWidth={2.25} />
            <span className="mul-onboarding-serif">Welcome to Multica</span>
          </div>

          <h1 className="mul-onboarding-serif mt-8 text-[clamp(2.5rem,5.5vw,3.75rem)] leading-[1.04] tracking-[-0.04em] text-[var(--mul-ink)]">
            Your AI teammates,
            <br />
            <em className="text-[var(--mul-accent)] italic">in one workspace.</em>
          </h1>

          <p className="mt-5 max-w-md text-[18px] leading-[1.55] text-[oklch(0.141_0.005_285.823/0.85)]">
            Assign them work like you&apos;d assign a colleague — they pick it up, update status, and comment when done.
          </p>
          <p className="mt-3 max-w-md text-[14px] leading-[1.5] text-[var(--mul-muted)]">
            Desktop bundles the runtime — nothing to install. Continue on web to connect your own CLI.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/download"
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-lg bg-[#0a0d12] px-5 text-[14px] font-medium text-white transition-colors hover:bg-black/85"
            >
              <Download className="size-4" />
              Download Desktop
            </Link>
            <button
              type="button"
              onClick={onNext}
              className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-lg border border-[var(--mul-line)] bg-white px-5 text-[14px] font-medium text-[var(--mul-ink)] transition-colors hover:bg-[var(--mul-line-2)]"
            >
              Continue on web
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col border-t border-[var(--mul-line)] bg-white lg:w-1/2 lg:border-t-0 lg:border-l">
        <div className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
          <p className="mul-onboarding-serif mb-8 text-center text-[15px] italic text-[var(--mul-muted)]">
            Every issue, every thread, every decision — shared by your team and agents.
          </p>
          <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3">
            {CARDS.map((card) => (
              <AgentCardView key={card.id} card={card} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
