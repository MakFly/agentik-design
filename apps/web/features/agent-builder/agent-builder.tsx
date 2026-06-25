"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, Rocket, Check, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBuilderStore } from "./store";
import { SectionNav } from "./section-nav";
import { BuilderForm } from "./builder-form";
import { ConfigPreview } from "./config-preview";
import { TestHarness } from "./test-harness";
import { PublishDialog } from "./publish-dialog";
import { validateDraft, errorCount } from "./validation";
import type { DraftIdentity } from "./validation";
import { draftKey, readDraft, writeDraft, clearDraft } from "./draft-storage";
import type { AgentConfig } from "@/types/domain";

const AUTOSAVE_MS = 800;

export function AgentBuilder({
  team,
  mode,
  initialIdentity,
  initialConfig,
}: {
  team: string;
  mode: "create" | "edit";
  initialIdentity?: Partial<DraftIdentity>;
  initialConfig?: AgentConfig;
}) {
  const init = useBuilderStore((s) => s.init);
  const identity = useBuilderStore((s) => s.identity);
  const config = useBuilderStore((s) => s.config);
  const activeSection = useBuilderStore((s) => s.activeSection);
  const setActiveSection = useBuilderStore((s) => s.setActiveSection);
  const saveState = useBuilderStore((s) => s.saveState);
  const setSaveState = useBuilderStore((s) => s.setSaveState);
  const rev = useBuilderStore((s) => s.rev);

  const [publishOpen, setPublishOpen] = useState(false);
  const key = draftKey(team, mode === "create" ? "new" : "edit");

  // initialize the draft once on mount — prefer a locally-saved draft over the route's
  // initial config so unpublished work survives reload/navigation (the "Draft saved" promise).
  useEffect(() => {
    const saved = readDraft(key);
    if (saved) init(saved.identity, saved.config);
    else init(initialIdentity, initialConfig);
  }, [init, key, initialIdentity, initialConfig]);

  // autosave draft: debounce on rev, flip dirty → saving → saved, persisting to localStorage.
  useEffect(() => {
    if (saveState !== "dirty") return;
    setSaveState("saving");
    const t = setTimeout(() => {
      writeDraft(key, { identity, config });
      setSaveState("saved");
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [rev, saveState, setSaveState, key, identity, config]);

  const issues = useMemo(() => validateDraft(identity, config), [identity, config]);
  const blocking = errorCount(issues);
  const canPublish = blocking === 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={mode === "create" ? "New agent" : identity.name || "Edit agent"}
        back={{ href: `/${team}/agents`, label: "Agents" }}
        description={<SaveIndicator state={saveState} />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setActiveSection("review")}>
              <Play className="size-4" /> Review
            </Button>
            <Button size="sm" disabled={!canPublish} onClick={() => setPublishOpen(true)}>
              <Rocket className="size-4" /> Publish
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,360px)]">
        {/* section nav */}
        <div className="lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:self-start">
          <SectionNav active={activeSection} issues={issues} onSelect={setActiveSection} />
        </div>

        {/* form */}
        <div className="min-w-0 rounded-lg border border-border bg-surface p-4 md:p-6">
          <BuilderForm section={activeSection} issues={issues} />
        </div>

        {/* preview + test */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:self-start">
          <ConfigPreview config={config} />
          <div className="rounded-lg border border-border bg-surface p-3">
            <Tabs defaultValue="test">
              <TabsList className="w-full">
                <TabsTrigger value="test" className="flex-1">
                  Test
                </TabsTrigger>
                <TabsTrigger value="about" className="flex-1">
                  About
                </TabsTrigger>
              </TabsList>
              <TabsContent value="test" className="pt-3">
                <TestHarness team={team} config={config} />
              </TabsContent>
              <TabsContent value="about" className="pt-3 text-sm text-muted-foreground">
                The test harness runs your draft in a sandbox and streams the trace — the same view
                you get on a real run. Publish creates an immutable version once validation passes.
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        team={team}
        identity={identity}
        config={config}
        disabled={!canPublish}
        onPublished={() => clearDraft(key)}
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: "idle" | "dirty" | "saving" | "saved" }) {
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-success">
        <Check className="size-3.5" /> Draft saved
      </span>
    );
  if (state === "dirty") return <span className="text-xs text-warning">Unsaved changes</span>;
  return <span className="text-xs text-muted-foreground">Draft</span>;
}
