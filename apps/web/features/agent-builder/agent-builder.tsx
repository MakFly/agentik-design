"use client";

import { useEffect, useMemo, useState } from "react";
import { Rocket, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BuilderStoreProvider, useBuilderStore } from "./store-context";
import { IdentityHeader } from "./identity-header";
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
  agentId,
  initialIdentity,
  initialConfig,
}: {
  team: string;
  mode: "create" | "edit";
  agentId?: string;
  initialIdentity?: Partial<DraftIdentity>;
  initialConfig?: AgentConfig;
}) {
  return (
    <BuilderStoreProvider initialIdentity={initialIdentity} initialConfig={initialConfig}>
      <BuilderShell
        team={team}
        mode={mode}
        agentId={agentId}
        initialIdentity={initialIdentity}
        initialConfig={initialConfig}
      />
    </BuilderStoreProvider>
  );
}

function BuilderShell({
  team,
  mode,
  agentId,
  initialIdentity,
  initialConfig,
}: {
  team: string;
  mode: "create" | "edit";
  agentId?: string;
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
  const key = draftKey(team, mode, agentId ?? "new");

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
  const canPublish = errorCount(issues) === 0;

  return (
    <div className="flex flex-col gap-5 pb-20 lg:pb-0">
      <IdentityHeader
        team={team}
        mode={mode}
        saveState={saveState}
        canPublish={canPublish}
        onReview={() => setActiveSection("review")}
        onPublish={() => setPublishOpen(true)}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,360px)]">
        {/* section nav */}
        <div className="lg:sticky lg:top-[calc(var(--navbar-h)+1rem)] lg:self-start">
          <SectionNav active={activeSection} issues={issues} onSelect={setActiveSection} />
        </div>

        {/* form */}
        <div className="min-w-0 rounded-lg border border-border bg-surface p-4 md:p-6">
          <BuilderForm section={activeSection} issues={issues} team={team} mode={mode} agentId={agentId} />
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
                The test harness runs your draft in a sandbox and streams the trace — the same view you get on a real run.
                Publish creates an immutable version once validation passes.
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* mobile sticky action bar — header buttons scroll away on long forms */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <Button variant="outline" className="min-h-[44px] flex-1" onClick={() => setActiveSection("review")}>
          <Play className="size-4" /> Review
        </Button>
        <Button className="min-h-[44px] flex-1" disabled={!canPublish} onClick={() => setPublishOpen(true)}>
          <Rocket className="size-4" /> Publish
        </Button>
      </div>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        team={team}
        mode={mode}
        agentId={agentId}
        identity={identity}
        config={config}
        disabled={!canPublish}
        onPublished={() => clearDraft(key)}
      />
    </div>
  );
}
