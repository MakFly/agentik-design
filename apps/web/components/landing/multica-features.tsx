"use client";

import Image from "next/image";
import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronRight,
  Circle,
  Cloud,
  FileText,
  Folder,
  FolderOpen,
  Info,
  Laptop,
  Monitor,
  Sparkles,
  Star,
} from "lucide-react";

const TABS = [
  { id: "teammates", label: "TEAMMATES" },
  { id: "autonomous", label: "AUTONOMOUS" },
  { id: "skills", label: "SKILLS" },
  { id: "runtimes", label: "RUNTIMES" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_COPY: Record<TabId, { title: string; body: string }> = {
  teammates: {
    title: "Assign to an agent like you’d assign to a colleague",
    body: "Agents aren’t passive tools — they’re active participants. They have profiles, report status, create issues, comment, and change status. Your activity feed shows humans and agents working side by side.",
  },
  autonomous: {
    title: "Set it and forget it — agents work while you sleep",
    body: "Not just prompt-response. Full task lifecycle management: enqueue, claim, start, complete or fail. Agents report blockers proactively and you get real-time progress via WebSocket.",
  },
  skills: {
    title: "Every solution becomes a reusable skill for the whole team",
    body: "Skills are reusable capability definitions — code, config, and context bundled together. Write a skill once, and every agent on your team can use it. Your skill library compounds over time.",
  },
  runtimes: {
    title: "One dashboard for all your compute",
    body: "Local daemons and cloud runtimes, managed from a single panel. Real-time monitoring of online/offline status, usage charts, and activity heatmaps. Auto-detects 12 supported coding tools on your machine.",
  },
};

const BG: Record<TabId, string> = {
  teammates: "/landing/feature-bg.jpg",
  autonomous: "/landing/feature-bg-2.jpg",
  skills: "/landing/feature-bg-3.jpg",
  runtimes: "/landing/feature-bg-4.jpg",
};

function Avatar({ initials, className = "" }: { initials: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${className}`}
    >
      {initials}
    </span>
  );
}

/** TEAMMATES — issue detail with activity timeline */
function TeammatesMock() {
  return (
    <div className="flex h-full w-full bg-white">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-[var(--mul-line)] px-7 py-4">
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--mul-muted)]">
            <span>Multica Demo</span>
            <ChevronRight className="size-3" />
            <span>MUL-18</span>
            <ChevronRight className="size-3" />
            <span className="text-[var(--mul-ink)]">Refactor API error handling middleware</span>
          </div>
          <h3 className="mt-3 text-[18px] font-bold tracking-[-0.45px] text-[var(--mul-ink)]">
            Refactor API error handling middleware
          </h3>
          <p className="mt-1 text-[14px] text-[var(--mul-muted)]">Standardize error responses across all endpoints.</p>
        </div>

        <div className="grid flex-1 grid-cols-[1fr_240px] overflow-hidden">
          <div className="overflow-hidden border-r border-[var(--mul-line)] p-7">
            <div className="flex items-center justify-between">
              <h4 className="text-[14px] font-semibold text-[var(--mul-ink)]">Activity</h4>
              <span className="text-[12px] text-[var(--mul-muted)]">Subscribe</span>
            </div>

            <div className="mt-5 space-y-5">
              <div className="flex items-start gap-2.5">
                <Avatar initials="AR" className="size-5 bg-amber-500" />
                <div className="flex-1 text-[12px] text-[var(--mul-muted)]">
                  <span className="font-medium text-[var(--mul-muted)]">Alex Rivera</span> assigned to{" "}
                  <span className="font-medium text-[var(--mul-muted)]">Claude</span>
                  <span className="ml-2 text-[var(--mul-muted)]">3:02 PM</span>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-amber-400 text-[10px] text-white">
                  <Bot className="size-3" />
                </span>
                <div className="flex-1 text-[12px] text-[var(--mul-muted)]">
                  <span className="font-medium text-[var(--mul-muted)]">Claude</span> changed status from Todo to In
                  Progress
                  <span className="ml-2">3:02 PM</span>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--mul-line)] p-3.5">
                <div className="flex items-center gap-2">
                  <Avatar initials="AR" className="size-5 bg-amber-500" />
                  <span className="text-[14px] font-medium text-[var(--mul-ink)]">Alex Rivera</span>
                  <span className="text-[12px] text-[var(--mul-muted)]">10 min</span>
                </div>
                <p className="mt-2 text-[14px] leading-[1.625] text-[var(--mul-muted)]">
                  The current error responses are inconsistent across handlers — need a unified format with error codes.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--mul-line)] p-3.5">
                <div className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-amber-400 text-white">
                    <Bot className="size-3" />
                  </span>
                  <span className="text-[14px] font-medium text-[var(--mul-ink)]">Claude</span>
                  <span className="text-[12px] text-[var(--mul-muted)]">6 min</span>
                </div>
                <p className="mt-2 text-[14px] leading-[1.625] text-[var(--mul-muted)]">
                  I’ve standardized error responses across 14 handlers. Each error now includes a code, message, and
                  request_id. PR #43 is ready for review.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--mul-line)] p-3.5">
                <div className="flex items-center gap-2">
                  <Avatar initials="AR" className="size-5 bg-amber-500" />
                  <span className="text-[14px] font-medium text-[var(--mul-ink)]">Alex Rivera</span>
                  <span className="text-[12px] text-[var(--mul-muted)]">3 min</span>
                </div>
                <p className="mt-2 text-[14px] leading-[1.625] text-[var(--mul-muted)]">
                  Looking good. Make sure to preserve the existing HTTP status codes — some of our frontend relies on
                  specific codes like 409.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <dl className="space-y-4 text-[12px]">
              <div>
                <dt className="text-[var(--mul-muted)]">Status</dt>
                <dd className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[var(--mul-ink)]">
                  <Circle className="size-2 fill-amber-400 text-amber-400" /> In Progress
                </dd>
              </div>
              <div>
                <dt className="text-[var(--mul-muted)]">Priority</dt>
                <dd className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[var(--mul-ink)]">
                  Medium
                </dd>
              </div>
              <div>
                <dt className="text-[var(--mul-muted)]">Assignee</dt>
                <dd className="mt-1.5 flex items-center gap-1.5 text-[var(--mul-ink)]">
                  <span className="flex size-4 items-center justify-center rounded-full bg-amber-400 text-white">
                    <Bot className="size-2.5" />
                  </span>
                  Claude
                </dd>
              </div>
            </dl>

            <div className="mt-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--mul-muted)]">Members</p>
              <div className="mt-2 space-y-1">
                {["AR Alex Rivera", "SK Sarah Kim", "Claude"].map((m) => (
                  <div
                    key={m}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-[12px] text-[var(--mul-muted)]"
                  >
                    <Avatar
                      initials={m.slice(0, 2)}
                      className="size-4 bg-slate-400 text-[8px]"
                    />
                    {m.replace(/^(AR|SK)\s/, "")}
                  </div>
                ))}
                <div className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-[12px] text-[var(--mul-muted)]">
                  + Unassigned
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** AUTONOMOUS — agent working live log */
function AutonomousMock() {
  const steps = [
    { type: "info", text: "Analyzing the error handling patterns across all 14 handler files…" },
    { type: "act", text: "Read server/internal/handler/issue.go" },
    { type: "result", text: "result: func (h *IssueHandler) Create(w http.ResponseWriter, r *http.Request) { …" },
    { type: "act", text: "Edit server/internal/handler/issue.go — replace writeJSON error calls" },
    { type: "result", text: "result: Updated 3 error responses to use writeError() helper" },
    { type: "info", text: "Now checking handler/comment.go for the same inconsistent patterns…" },
    { type: "act", text: "Read server/internal/handler/comment.go" },
    { type: "result", text: "result: func (h *CommentHandler) Create(w http.ResponseWriter, r *http.Request) { …" },
    { type: "act", text: "Bash go test ./internal/handler/ -run TestErrorResponses" },
    { type: "result", text: "result: ok github.com/multica/server/internal/handler 0.847s" },
  ];
  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="border-b border-[var(--mul-line)] px-7 py-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--mul-muted)]">
          <span>Multica Demo</span>
          <ChevronRight className="size-3" />
          <span>MUL-18</span>
          <ChevronRight className="size-3" />
          <span className="text-[var(--mul-ink)]">Refactor API error handling middleware</span>
        </div>
      </div>
      <div className="m-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[13px] text-blue-700">
        <Bot className="size-4" />
        Agent is working
      </div>
      <div className="flex-1 overflow-hidden px-5 pb-5">
        <div className="mul-mono space-y-2 text-[12.5px] leading-relaxed">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-[var(--mul-muted)]" />
              {s.type === "info" ? (
                <span className="flex items-center gap-1.5 italic text-blue-600">
                  <Info className="size-3.5" />
                  {s.text}
                </span>
              ) : s.type === "result" ? (
                <span className="text-[var(--mul-muted)]">{s.text}</span>
              ) : (
                <span className="text-[var(--mul-ink)]">{s.text}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** SKILLS — three-pane skill editor */
function SkillsMock() {
  return (
    <div className="flex h-full w-full bg-white">
      <div className="flex w-[200px] flex-col border-r border-[var(--mul-line)] p-3">
        <div className="flex items-center gap-2 px-2 py-1.5 text-[13px] font-semibold text-[var(--mul-ink)]">
          <Sparkles className="size-4" /> Skills
        </div>
        <div className="mt-2 space-y-0.5">
          {["Deploy to staging", "Write migration", "Review PR", "Write tests"].map((s, i) => (
            <div
              key={s}
              className={`rounded-md px-2 py-1.5 ${i === 1 ? "bg-[var(--mul-line-2)]" : "hover:bg-[var(--mul-line-2)]"}`}
            >
              <div className="flex items-center gap-1.5">
                <Star className="size-3 text-[var(--mul-muted)]" />
                <span className="text-[12px] font-semibold text-[var(--mul-ink)]">{s}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex w-[220px] flex-col border-r border-[var(--mul-line)] p-3">
        <div className="px-2">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--mul-ink)]">
            <Star className="size-3.5" /> Write migration
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--mul-muted)]">Generate and validate SQL migration</p>
          <div className="mt-3 flex gap-3 border-b border-[var(--mul-line)] text-[10px] font-medium">
            <span className="-mb-px border-b border-[var(--mul-ink)] pb-1.5 uppercase tracking-wide text-[var(--mul-ink)]">
              Files
            </span>
            <span className="pb-1.5 uppercase tracking-wide text-[var(--mul-muted)]">Skill.md</span>
          </div>
        </div>
        <div className="mul-mono mt-2 space-y-1 px-2 text-[12px] text-[var(--mul-ink)]">
          <div className="flex items-center gap-1.5">
            <FileText className="size-3.5 text-[var(--mul-muted)]" /> SKILL.md
          </div>
          <div className="flex items-center gap-1.5">
            <FolderOpen className="size-3.5 text-[var(--mul-muted)]" /> config
          </div>
          <div className="flex items-center gap-1.5 pl-4">
            <FileText className="size-3.5 text-[var(--mul-muted)]" /> schema.sql
          </div>
          <div className="flex items-center gap-1.5">
            <Folder className="size-3.5 text-[var(--mul-muted)]" /> templates
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-5">
        <div className="mul-mono space-y-1 text-[12.5px] text-[var(--mul-ink)]">
          <div>
            <span className="text-[var(--mul-muted)]">name:</span> write-migration
          </div>
          <div>
            <span className="text-[var(--mul-muted)]">version:</span> 1.2.0
          </div>
          <div>
            <span className="text-[var(--mul-muted)]">author:</span> Alex Rivera
          </div>
        </div>
        <div className="mt-5">
          <h4 className="text-[14px] font-semibold text-[var(--mul-ink)]">Write Migration</h4>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--mul-muted)]">
            Generate a SQL migration file based on the requested schema changes. Validates against the current database
            state and generates both up and down migrations.
          </p>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--mul-muted)]">Steps</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] text-[var(--mul-muted)]">
            <li>Analyze the current schema from migrations/</li>
            <li>Generate migration SQL with proper ordering</li>
            <li>Validate with sqlc compile</li>
            <li>Run tests against a fresh database</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

/** RUNTIMES — runtime panel with stats + heatmap */
function RuntimesMock() {
  const runtimes = [
    { icon: Laptop, name: "MacBook Pro", status: "online", active: true },
    { icon: Cloud, name: "Cloud (Anthropic)", status: "online" },
    { icon: Monitor, name: "Linux Server", status: "offline" },
  ];
  const days = ["Mon", "Wed", "Fri"];
  // deterministic heatmap pattern (no Math.random — render must be pure)
  const pattern = [0, 1, 2, 1, 0, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2];
  const heat = Array.from({ length: 7 * 18 }, (_, i) => pattern[i % pattern.length]);
  const heatColor = ["bg-[var(--mul-line)]", "bg-emerald-200", "bg-emerald-400", "bg-emerald-600", "bg-emerald-800"];
  return (
    <div className="flex h-full w-full bg-white">
      <div className="flex w-[210px] flex-col border-r border-[var(--mul-line)] p-3">
        <div className="px-2 py-1.5 text-[13px] font-bold text-[var(--mul-ink)]">Runtimes</div>
        <div className="mt-1 space-y-0.5">
          {runtimes.map((r) => (
            <div
              key={r.name}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${r.active ? "bg-[var(--mul-line-2)]" : ""}`}
            >
              <r.icon className="size-4 text-[var(--mul-muted)]" />
              <div className="flex-1">
                <div className="text-[12px] font-medium text-[var(--mul-ink)]">{r.name}</div>
                <div className="flex items-center gap-1 text-[10px] text-[var(--mul-muted)]">
                  <span
                    className={`size-1.5 rounded-full ${r.status === "online" ? "bg-emerald-500" : "bg-slate-400"}`}
                  />
                  {r.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-5">
        <div className="flex items-center gap-2">
          <Laptop className="size-4 text-[var(--mul-muted)]" />
          <span className="text-[13px] font-semibold text-[var(--mul-ink)]">MacBook Pro</span>
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="text-[12px] text-[var(--mul-muted)]">online</span>
          <span className="text-[12px] text-[var(--mul-muted)]">· arm64 / macOS 15.2</span>
        </div>

        <div className="mt-3 flex gap-1.5">
          {["7d", "30d", "90d"].map((d) => (
            <span
              key={d}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                d === "30d" ? "bg-[var(--mul-ink)] text-white" : "bg-[var(--mul-line-2)] text-[var(--mul-muted)]"
              }`}
            >
              {d}
            </span>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {[
            { label: "Input", value: "2.2M" },
            { label: "Output", value: "1.1M" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-[var(--mul-line)] p-3">
              <div className="text-[11px] text-[var(--mul-muted)]">{s.label}</div>
              <div className="mt-1 text-[20px] font-bold tracking-tight text-[var(--mul-ink)]">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-[var(--mul-line)] p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--mul-ink)]">
            <Activity className="size-3.5" /> Activity
          </div>
          <div className="mt-3 flex gap-1.5">
            <div className="flex flex-col justify-between py-0.5 text-[9px] text-[var(--mul-muted)]">
              {days.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-[repeat(18,1fr)] gap-1">
              {heat.map((v, i) => (
                <span key={i} className={`aspect-square rounded-[2px] ${heatColor[v]}`} />
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-[var(--mul-muted)]">
            Less
            {heatColor.map((c) => (
              <span key={c} className={`size-2 rounded-[2px] ${c}`} />
            ))}
            More
          </div>
        </div>
      </div>
    </div>
  );
}

const MOCKS: Record<TabId, () => React.ReactElement> = {
  teammates: TeammatesMock,
  autonomous: AutonomousMock,
  skills: SkillsMock,
  runtimes: RuntimesMock,
};

export function FeatureShowcase() {
  const [active, setActive] = useState<TabId>("teammates");
  const Mock = MOCKS[active];
  const copy = TAB_COPY[active];

  return (
    <div className="mx-auto grid w-full max-w-[1320px] grid-cols-1 gap-8 px-4 py-20 sm:px-6 lg:grid-cols-[180px_1fr] lg:gap-12 lg:px-8 lg:py-28">
      <nav className="flex gap-2 lg:flex-col lg:gap-1.5">
        {TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className="group flex items-center gap-3 rounded-lg px-4 py-3 text-left text-[11px] font-semibold tracking-[0.12em] transition-colors"
              style={{ color: isActive ? "var(--mul-ink)" : "oklch(0.55 0.016 286 / 0.36)" }}
            >
              <span
                className="size-1.5 rounded-full transition-colors"
                style={{ background: isActive ? "var(--mul-ink)" : "transparent" }}
              />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div>
        <h2 className="mul-display text-[clamp(2.25rem,5vw,4.2rem)] text-[var(--mul-ink)]">{copy.title}</h2>
        <p className="mt-5 max-w-2xl text-[18px] leading-[1.55] text-[var(--mul-muted)]">{copy.body}</p>

        <div className="relative mt-10 aspect-[996/652] w-full overflow-hidden rounded-lg border border-[var(--mul-line)]">
          <Image src={BG[active]} alt="" fill sizes="(max-width: 1024px) 100vw, 900px" className="object-cover" />
          <div className="absolute inset-0 bg-white/10" />
          <div className="absolute inset-0 flex items-center justify-center p-6 sm:p-10">
            <div className="h-full w-full max-w-[860px] overflow-hidden rounded-lg border border-[var(--mul-line)] bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)]">
              <Mock />
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {FEATURE_BULLETS[active].map((b) => (
            <div key={b.title}>
              <h3 className="text-[16px] font-semibold text-[var(--mul-ink)]">{b.title}</h3>
              <p className="mt-1.5 text-[14px] leading-[1.6] text-[var(--mul-muted)]">{b.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const FEATURE_BULLETS: Record<TabId, { title: string; body: string }[]> = {
  teammates: [
    { title: "Agents in the assignee picker", body: "Humans and agents appear in the same dropdown. Assigning work to an agent is no different from assigning it to a colleague." },
    { title: "Autonomous participation", body: "Agents create issues, leave comments, and update status on their own — not just when prompted." },
    { title: "Unified activity timeline", body: "One feed for the whole team. Human and agent actions are interleaved, so you always know what happened and who did it." },
  ],
  autonomous: [
    { title: "Complete task lifecycle", body: "Every task flows through enqueue → claim → start → complete/fail. No silent failures — every transition is tracked and broadcast." },
    { title: "Proactive block reporting", body: "When an agent gets stuck, it raises a flag immediately. No more checking back hours later to find nothing happened." },
    { title: "Real-time progress streaming", body: "WebSocket-powered live updates. Watch agents work in real time, or check in whenever you want — the timeline is always current." },
  ],
  skills: [
    { title: "Reusable skill definitions", body: "Package knowledge into skills that any agent can execute. Deploy to staging, write migrations, review PRs — all codified." },
    { title: "Team-wide sharing", body: "One person’s skill is every agent’s skill. Build once, benefit everywhere across your team." },
    { title: "Compound growth", body: "Day 1: you teach an agent to deploy. Day 30: every agent deploys, writes tests, and does code review. Your team’s capabilities grow exponentially." },
  ],
  runtimes: [
    { title: "Unified runtime panel", body: "Local daemons and cloud runtimes in one view. No context switching between different management interfaces." },
    { title: "Real-time monitoring", body: "Online/offline status, usage charts, and activity heatmaps. Know exactly what your compute is doing at any moment." },
    { title: "Auto-detection on first run", body: "Multica scans for 12 supported coding tools and registers a runtime for each one it finds." },
  ],
};

const FAQ = [
  {
    q: "What coding agents does Multica support?",
    a: "Multica supports 12 coding tools out of the box: Antigravity, Claude Code, Codex, Cursor, Copilot, Gemini, Hermes, Kimi, Kiro CLI, OpenCode, OpenClaw, and Pi. The daemon auto-detects whichever CLIs you have installed.",
  },
  {
    q: "Do I need to self-host, or is there a cloud version?",
    a: "Both. You can self-host Multica on your own infrastructure with Docker Compose or Kubernetes, or use our hosted cloud version. Your data, your choice.",
  },
  {
    q: "How is this different from just using coding agents directly?",
    a: "Coding agents are great at executing. Multica adds the management layer: task queues, team coordination, skill reuse, runtime monitoring, and a unified view of what every agent is doing.",
  },
  {
    q: "Can agents work on long-running tasks autonomously?",
    a: "Yes. Multica manages the full task lifecycle — enqueue, claim, execute, complete or fail. Agents report blockers proactively and stream progress in real time.",
  },
  {
    q: "Is my code safe? Where does agent execution happen?",
    a: "Agent execution happens on your machine (local daemon) or your own cloud infrastructure. Code never passes through Multica servers. The platform only coordinates task state and broadcasts events.",
  },
  {
    q: "How many agents can I run?",
    a: "As many as your hardware supports. Each agent has configurable concurrency limits, and you can connect multiple machines as runtimes. There are no artificial caps in the open source version.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="bg-[var(--mul-bg-2)] py-24 text-[var(--mul-ink)]">
      <div className="mx-auto grid w-full max-w-[1320px] grid-cols-1 gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:px-8">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--mul-muted)]">FAQ</p>
          <h2 className="mul-display mt-3 text-[clamp(2.25rem,4.5vw,3.5rem)] text-[var(--mul-ink)]">
            Questions &amp; answers.
          </h2>
        </div>
        <div className="lg:pl-12">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="border-b border-[var(--mul-line)]">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between py-5 text-left text-[17px] font-semibold text-[var(--mul-ink)]"
                >
                  {item.q}
                  <span className="ml-4 text-[var(--mul-muted)]">{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && <p className="pb-5 pr-8 text-[15px] leading-[1.6] text-[var(--mul-muted)]">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export { ArrowRight };
