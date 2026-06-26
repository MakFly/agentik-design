"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Download, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StepHeader } from "../step-header";

export function StepPlatform({
  onComplete,
  onBack,
  busy,
}: {
  onComplete: () => void;
  onBack?: () => void;
  busy?: boolean;
}) {
  const [downloaded, setDownloaded] = useState(false);

  const pickDesktop = () => {
    window.open("/download", "_blank", "noopener,noreferrer");
    setDownloaded(true);
  };

  return (
    <div className="mul-landing animate-onboarding-enter grid min-h-dvh grid-cols-1 bg-white lg:grid-cols-[minmax(0,1fr)_480px]">
      <div className="flex min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-4 bg-white px-6 py-3 sm:px-10 md:px-14 lg:px-16">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-[var(--mul-muted)] transition-colors hover:text-[var(--mul-ink)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          ) : (
            <span aria-hidden className="w-0" />
          )}
          <div className="flex-1">
            <StepHeader currentStep="runtime" />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[620px] px-6 py-10 sm:px-10 md:px-14 lg:py-14">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--mul-muted)]">
              Connect a computer
            </div>
            <h1 className="mul-onboarding-serif text-balance text-[36px] font-medium leading-[1.1] tracking-tight text-[var(--mul-ink)]">
              Connect a computer to run your agent.
            </h1>
            <p className="mt-4 max-w-[560px] text-[15.5px] leading-[1.55] text-[var(--mul-muted)]">
              Your agent runs on a real computer that you connect to Multica. Pick how you want to connect one.
            </p>

            <div className="mt-10 flex max-w-[560px] flex-col gap-3.5">
              <button
                type="button"
                onClick={pickDesktop}
                className={cn(
                  "group flex items-center justify-between gap-4 rounded-xl bg-[#0a0d12] px-6 py-5 text-left text-white transition-transform hover:-translate-y-0.5",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[17px] font-medium tracking-tight">
                    <Download className="h-4 w-4" aria-hidden />
                    {downloaded ? "Opening the download page…" : "Use this computer"}
                  </div>
                  <div className="mt-1 text-[13px] text-white/60">
                    {downloaded
                      ? "Opened in a new tab. Pick your installer there, then finish setup on desktop."
                      : "Install our desktop app to connect this computer. Zero setup — pick your platform on the next page."}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium transition-colors group-hover:bg-white/20">
                  Download
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </button>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--mul-line)] bg-white px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[14.5px] font-medium text-[var(--mul-ink)]">
                    <Terminal className="h-4 w-4" />
                    Connect from the terminal
                  </div>
                  <div className="mt-1 text-[12.5px] leading-[1.5] text-[var(--mul-muted)]">
                    Run <code className="font-mono text-[12px]">agentik setup</code> on a server or dev box.
                  </div>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={onComplete} disabled={busy}>
                  Continue on web
                </Button>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--mul-line)] bg-white px-5 py-4 opacity-70">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-medium text-[var(--mul-ink)]">Use a cloud computer</div>
                  <div className="mt-1 text-[12.5px] leading-[1.5] text-[var(--mul-muted)]">
                    We&apos;ll run a computer for you in the cloud. Not live yet.
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--mul-line)] bg-[var(--mul-line-2)] px-3 py-1 text-[12px] font-medium text-[var(--mul-muted)]">
                  Coming soon
                </span>
              </div>
            </div>

            <div className="mt-8 flex max-w-[560px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <span className="text-xs text-[var(--mul-muted)]">
                {downloaded
                  ? "Finish setup on the download page, then come back to this tab."
                  : "Pick a way to connect — or skip and connect a computer later."}
              </span>
              <Button variant="secondary" onClick={onComplete} disabled={busy}>
                Skip for now
              </Button>
            </div>
          </div>
        </main>
      </div>

      <aside className="hidden min-h-0 border-l border-[var(--mul-line)] bg-[var(--mul-bg-2)] lg:flex lg:flex-col">
        <div className="flex flex-1 flex-col justify-center px-12 py-12">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--mul-muted)]">
            What&apos;s an agent runtime?
          </p>
          <p className="mt-4 text-[14px] leading-[1.6] text-[var(--mul-muted)]">
            The computer you connect is an <strong className="font-medium text-[var(--mul-ink)]">agent runtime</strong>{" "}
            — a small background process paired with one AI coding tool. It&apos;s what actually executes the tasks your
            agent picks up.
          </p>
        </div>
      </aside>
    </div>
  );
}
