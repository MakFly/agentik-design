"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { cn } from "@/lib/utils";

/** Runtime baked into a seeded agent name like "Sandbox (hermes)"; null otherwise. */
export function runtimeFromName(name: string): string | null {
  return name.match(/\(([a-z0-9_-]+)\)\s*$/i)?.[1]?.toLowerCase() ?? null;
}

/**
 * API runtimes run in-process through the chat gateway (no daemon required), so a
 * daemon-offline state does NOT mean the agent is unusable. CLI/daemon runtimes do need
 * a live daemon. Used to show an accurate "ready" vs "no runtime" label.
 */
const API_RUNTIMES = new Set(["openai", "anthropic", "claude", "google", "gemini", "codex"]);
export function isApiRuntime(runtimeKind?: string | null): boolean {
  return !!runtimeKind && API_RUNTIMES.has(runtimeKind.toLowerCase());
}

/** First glyph for the avatar — skip a leading "Sandbox" so the initial is meaningful. */
export function agentInitial(name: string): string {
  const cleaned = name.replace(/^sandbox\s*/i, "").replace(/[()]/g, "").trim() || name;
  return (cleaned[0] ?? "?").toUpperCase();
}

export function useDaemonOnline(team: string): boolean {
  const { data } = useQuery({
    queryKey: qk.settings.system(team),
    queryFn: ({ signal }) =>
      apiFetch<{ daemons: { status: string }[] }>("/system", { team, signal }),
    refetchInterval: 5000,
  });
  return (data?.daemons ?? []).some((d) => d.status === "online");
}

export function AgentAvatar({
  name,
  online,
  size = "md",
}: {
  name: string;
  online: boolean;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "size-9 rounded-xl text-xs" : "size-6 rounded-lg text-[10px]";
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center bg-running/12 font-semibold text-running ring-1 ring-inset ring-running/25",
        dim,
      )}
    >
      {agentInitial(name)}
      {size === "md" && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background",
            online ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
      )}
    </span>
  );
}
