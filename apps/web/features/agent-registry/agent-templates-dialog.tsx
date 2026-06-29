"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, ArrowRight, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RbacGate } from "@/lib/auth/rbac";
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
} from "./agent-templates";

export function TemplatesButton({ team }: { team: string }) {
  const [open, setOpen] = useState(false);
  return (
    <RbacGate permission="agent:create">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <LayoutTemplate className="size-4" /> Depuis un modèle
      </Button>
      <TemplatesDialog team={team} open={open} onOpenChange={setOpen} />
    </RbacGate>
  );
}

function TemplatesDialog({
  team,
  open,
  onOpenChange,
}: {
  team: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [harness, setHarness] = useState<HarnessId>(DEFAULT_HARNESS);
  const [templateId, setTemplateId] = useState<string | null>(null);
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

  function openInBuilder() {
    if (!templateId) return;
    onOpenChange(false);
    router.push(`/${team}/agents/new?template=${templateId}&harness=${harness}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setTemplateId(null);
          setQuery("");
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Démarrer depuis un modèle</DialogTitle>
          <DialogDescription>
            Choisis un harness et un agent préconfiguré. Le builder s'ouvrira avec une base prête à relire.
          </DialogDescription>
        </DialogHeader>

        {/* Harness selector */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-foreground">Harness</legend>
          <div className="flex flex-wrap gap-2">
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
                    "flex min-h-[44px] flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-primary"
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

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un modèle..."
            className="pl-9"
            aria-label="Rechercher un modèle"
          />
        </div>

        {/* Template gallery */}
        <div className="-mx-1 max-h-[48dvh] overflow-y-auto px-1">
          {total === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucun modèle ne correspond à &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <section key={g.category} className="flex flex-col gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.category}
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {g.items.map((t) => {
                      const on = t.id === templateId;
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTemplateId(t.id)}
                          aria-pressed={on}
                          className={cn(
                            "flex min-h-[44px] flex-col gap-2 rounded-lg border bg-surface p-3 text-left transition-colors",
                            on ? "border-primary ring-1 ring-primary" : "border-border hover:bg-surface-2",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
                              <Icon className="size-4" />
                            </span>
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                              <span className="truncate text-[11px] text-muted-foreground">{t.role}</span>
                            </span>
                            <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                              {TIER_LABEL[t.tier]}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{t.description}</p>
                          <div className="flex flex-wrap gap-1">
                            {t.suggestedTools.map((tool) => (
                              <Badge key={tool} variant="secondary" className="text-[10px]">
                                {tool}
                              </Badge>
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={openInBuilder} disabled={!templateId}>
            Ouvrir dans le builder <ArrowRight className="size-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
