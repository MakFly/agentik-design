"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Search, Sparkles, Plus } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AGENT_TEMPLATES,
  CATEGORY_ORDER,
  HARNESSES,
  DEFAULT_HARNESS,
  TIER_LABEL,
  findHarness,
  type HarnessId,
  type AgentTemplate,
} from "@/features/agent-registry/agent-templates";

const EYEBROW = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

/**
 * Step 1 of the foundry (OpenClaw × Hermes): pick an archetype + harness before
 * dropping into the operator config console. Reuses AGENT_TEMPLATES/HARNESSES —
 * selecting routes to `/agents/new?template=…&harness=…`; "scratch" → `?blank=1`.
 */
export function ArchetypeGallery({ team }: { team: string }) {
  const router = useRouter();
  const [harness, setHarness] = useState<HarnessId>(DEFAULT_HARNESS);
  const [query, setQuery] = useState("");

  const activeHarness = findHarness(harness)!;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: AgentTemplate) =>
      !q || `${t.name} ${t.role} ${t.description} ${t.category}`.toLowerCase().includes(q);
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: AGENT_TEMPLATES.filter((t) => t.category === category && matches(t)),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  function open(templateId: string) {
    router.push(`/${team}/platform/agents/new?template=${templateId}&harness=${harness}`);
  }
  function openBlank() {
    router.push(`/${team}/platform/agents/new?blank=1&harness=${harness}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
        {/* hero */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/${team}/platform/agents`}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Agents
            </Link>
            <span className={EYEBROW}>New agent</span>
          </div>
          <h1 className="text-[clamp(1.5rem,1.2rem+1.6vw,2.1rem)] font-semibold tracking-tight">
            Forge a new agent
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Pick a runtime and an archetype to start from a working blueprint — or
            build one from scratch. You can tune everything in the next step.
          </p>
        </div>

        {/* harness selector */}
        <fieldset className="flex flex-col gap-2">
          <legend className={cn(EYEBROW, "mb-2")}>Runtime</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {HARNESSES.map((h) => {
              const on = h.id === harness;
              const Icon = h.icon;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHarness(h.id)}
                  aria-pressed={on}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    on
                      ? "border-ring bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-surface-2",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{h.label}</span>
                    <span className="truncate text-[11px] opacity-70">{h.tagline}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{activeHarness.authNote}</p>
        </fieldset>

        {/* search + scratch */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search archetypes…"
              className="min-h-[44px] pl-9"
              aria-label="Search archetypes"
            />
          </div>
          <button
            type="button"
            onClick={openBlank}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            <Plus className="size-4" /> Start from scratch
          </button>
        </div>

        {/* archetype grid */}
        {total === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No archetype matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <section key={g.category} className="flex flex-col gap-2.5">
                <h2 className={EYEBROW}>{g.category}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.items.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => open(t.id)}
                        className="group flex min-h-[44px] flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-ring hover:bg-surface-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                            <Icon className="size-5" />
                          </span>
                          <span className="flex min-w-0 flex-col leading-tight">
                            <span className="truncate text-sm font-semibold text-foreground">
                              {t.name}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">
                              {t.role}
                            </span>
                          </span>
                          <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[10px]">
                            {TIER_LABEL[t.tier]}
                          </Badge>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                        <div className="mt-auto flex flex-wrap items-center gap-1">
                          {t.suggestedTools.slice(0, 3).map((tool) => (
                            <Badge key={tool} variant="secondary" className="text-[10px]">
                              {tool}
                            </Badge>
                          ))}
                          <ArrowRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-accent-foreground" />
          Archetypes preload a system prompt, model tier, and defaults — fully editable.
        </p>
    </div>
  );
}
