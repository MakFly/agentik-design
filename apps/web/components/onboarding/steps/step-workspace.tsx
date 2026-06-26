"use client";

import { ArrowLeft, ArrowRight, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepHeader } from "../step-header";

export function StepWorkspace({
  name,
  slug,
  onAdvance,
  onBack,
}: {
  name: string;
  slug: string;
  onAdvance: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="mul-landing animate-onboarding-enter flex min-h-dvh flex-col bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_480px]">
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
            <StepHeader currentStep="workspace" />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[620px] px-6 py-10 sm:px-10 md:px-14 lg:py-14">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--mul-muted)]">
              Your workspace
            </div>
            <div className="mb-1 font-mono text-xs text-[var(--mul-muted)]">04</div>
            <h1 className="mul-onboarding-serif text-balance text-[36px] font-medium leading-[1.1] tracking-tight text-[var(--mul-ink)]">
              Continue with {name}.
            </h1>
            <p className="mt-4 max-w-[560px] text-[15.5px] leading-[1.55] text-[var(--mul-muted)]">
              Your workspace was created automatically. Open it to connect a computer and create your first agent.
            </p>

            <button
              type="button"
              onClick={onAdvance}
              className="mt-10 flex w-full max-w-[560px] items-center justify-between gap-4 rounded-xl border border-[var(--mul-line)] bg-white px-5 py-4 text-left transition-colors hover:border-[var(--mul-ink)]/30 hover:bg-[var(--mul-line-2)]"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-[var(--mul-line-2)] text-[var(--mul-ink)]">
                  <FolderKanban className="size-5" />
                </span>
                <div>
                  <div className="text-[15px] font-medium text-[var(--mul-ink)]">{name}</div>
                  <div className="text-[13px] text-[var(--mul-muted)]">/{slug}</div>
                </div>
              </div>
              <ArrowRight className="size-4 text-[var(--mul-muted)]" />
            </button>

            <div className="mt-8 flex max-w-[560px] flex-wrap items-center justify-end gap-x-4 gap-y-2">
              <span className="mr-auto text-xs text-[var(--mul-muted)]">Opening {name}.</span>
              <Button size="lg" onClick={onAdvance}>
                Open {name}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </main>
      </div>

      <aside className="hidden min-h-0 border-l border-[var(--mul-line)] bg-[var(--mul-bg-2)] lg:flex lg:flex-col">
        <div className="flex flex-1 flex-col justify-center px-12 py-12">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--mul-muted)]">What&apos;s next</p>
          <ul className="mt-6 space-y-4 text-[14px] leading-[1.5] text-[var(--mul-ink)]">
            <li>Connect a computer so your agents have somewhere to run</li>
            <li>Create your first agent from a connected runtime</li>
            <li>Assign an issue and watch it work</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
