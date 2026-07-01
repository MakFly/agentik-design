"use client";
import { useAgentsBase } from "@/lib/agents/use-agents-base";

import Link from "next/link";
import { ArrowLeft, Check, Loader2, Play, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBuilderStore } from "./store-context";
import { EmojiColorPicker } from "./emoji-color-picker";
import type { SaveState } from "./store";

/**
 * Identity-first header (OpenClaw shape): the agent's avatar (emoji + color) and
 * name lead the builder, with save state and the Review / Publish actions.
 */
export function IdentityHeader({
  team,
  mode,
  saveState,
  canPublish,
  onReview,
  onPublish,
}: {
  team: string;
  mode: "create" | "edit";
  saveState: SaveState;
  canPublish: boolean;
  onReview: () => void;
  onPublish: () => void;
}) {
  const base = useAgentsBase(team);
  const identity = useBuilderStore((s) => s.identity);
  const patchIdentity = useBuilderStore((s) => s.patchIdentity);

  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`${base}`}
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Agents
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <EmojiColorPicker emoji={identity.emoji} color={identity.color} onChange={(patch) => patchIdentity(patch)} />
          <div className="min-w-0 flex-1">
            <Input
              value={identity.name}
              onChange={(e) => patchIdentity({ name: e.target.value })}
              placeholder={mode === "create" ? "New agent" : "Agent name"}
              aria-label="Agent name"
              className="h-auto border-0 bg-transparent px-0 text-[clamp(1.25rem,1rem+1.2vw,1.6rem)] font-semibold tracking-tight shadow-none focus-visible:ring-0"
            />
            <p className="truncate text-sm text-muted-foreground">{identity.role || "Set a role in Persona"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:shrink-0">
          <SaveIndicator state={saveState} />
          <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-9" onClick={onReview}>
            <Play className="size-4" /> Review
          </Button>
          <Button size="sm" className="min-h-[44px] sm:min-h-9" disabled={!canPublish} onClick={onPublish}>
            <Rocket className="size-4" /> Publish
          </Button>
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="hidden items-center gap-1.5 text-xs text-success sm:inline-flex">
        <Check className="size-3.5" /> Draft saved
      </span>
    );
  if (state === "dirty") return <span className="hidden text-xs text-warning sm:inline">Unsaved</span>;
  return <span className="hidden text-xs text-muted-foreground sm:inline">Draft</span>;
}
