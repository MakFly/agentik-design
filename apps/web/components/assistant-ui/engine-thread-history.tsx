"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { useAssistantRuntime, type AssistantRuntime } from "@assistant-ui/react";
import { MoreHorizontalIcon, PlusIcon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";
import { realtime, type RealtimeEvent } from "@/lib/realtime/ws-client";

/**
 * Engine-backed thread history: an assistant-ui thread is an engine chat session
 * (chat_sessions). The rail lists the team's sessions (persistent across browsers and
 * devices); selecting one loads its turns into the runtime. The engine is the source of
 * truth — turns are persisted server-side by the chat bridge, so this provider only
 * reads (no local write-back loop). Session creation happens in the runtime transport
 * on first send, which emits `agentik:chat-session-created`.
 */

interface SessionSummary {
  id: string;
  agentId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface MessageView {
  id: string;
  role: string;
  content: string;
  taskId: string | null;
  createdAt: string;
}

type EngineThreadHistoryContextValue = {
  threads: SessionSummary[];
  activeThreadId: string | null;
  title: string;
  missingThreadId: string | null;
  createNewThread: () => void;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
};

const EngineThreadHistoryContext =
  createContext<EngineThreadHistoryContextValue | null>(null);

function sessionTitle(s: SessionSummary | undefined): string {
  return s?.title?.trim() || "New conversation";
}

/** Engine messages → assistant-ui external state (a linear, single-branch thread). */
function toExternalState(messages: MessageView[]) {
  const stored = messages
    .filter((m) => m.content?.trim())
    .map((m, i, arr) => ({
      parentId: i === 0 ? null : arr[i - 1]!.id,
      message: {
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        parts: [{ type: "text", text: m.content }],
        metadata: { custom: {} },
      },
    }));
  return { messages: stored, headId: stored.at(-1)?.message.id ?? null };
}

function pushUrl(href: string) {
  if (typeof window === "undefined" || window.location.pathname === href) return;
  window.history.pushState(null, "", href);
}

export function EngineThreadHistoryProvider({
  children,
  routeThreadId,
  team,
}: {
  children: ReactNode;
  routeThreadId?: string;
  team: string;
}) {
  const runtime = useAssistantRuntime();
  const [threads, setThreads] = useState<SessionSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    routeThreadId ?? null,
  );
  const [missingThreadId, setMissingThreadId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(activeThreadId);
  useEffect(() => {
    activeRef.current = activeThreadId;
  }, [activeThreadId]);

  const refreshList = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: SessionSummary[] }>("/chat/sessions", {
        team,
      });
      setThreads(res.items);
    } catch {
      // Engine unreachable: keep whatever we have; the composer still works.
    }
  }, [team]);

  const loadThread = useCallback(
    async (aui: AssistantRuntime, id: string) => {
      try {
        const detail = await apiFetch<{ messages: MessageView[] }>(
          `/chat/sessions/${id}`,
          { team },
        );
        setMissingThreadId(null);
        aui.thread.importExternalState(toExternalState(detail.messages));
      } catch {
        setMissingThreadId(id);
        try {
          aui.thread.importExternalState({ messages: [] });
        } catch {
          /* runtime not ready */
        }
      }
    },
    [team],
  );

  // Initial hydration: list sessions, and load the routed thread (or start clean).
  useEffect(() => {
    void refreshList();
    if (routeThreadId) {
      setActiveThreadId(routeThreadId);
      void loadThread(runtime, routeThreadId);
    } else {
      setActiveThreadId(null);
      runtime.thread.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeThreadId]);

  // A new session was created by the transport mid-send: adopt it (do NOT re-import —
  // the runtime already holds the live, streaming turn) and surface it in the rail.
  useEffect(() => {
    const onCreated = (e: Event) => {
      const id = (e as CustomEvent<{ sessionId: string }>).detail?.sessionId;
      if (!id) return;
      setActiveThreadId(id);
      setMissingThreadId(null);
      void refreshList();
    };
    window.addEventListener("agentik:chat-session-created", onCreated);
    return () =>
      window.removeEventListener("agentik:chat-session-created", onCreated);
  }, [refreshList]);

  // Keep the rail fresh as turns land (titles, ordering) without polling.
  useEffect(() => {
    realtime.connect(team);
    const unsub = realtime.subscribe((event: RealtimeEvent) => {
      if (event.kind === "chat.message") void refreshList();
    });
    return () => unsub();
  }, [team, refreshList]);

  const createNewThread = useCallback(() => {
    setActiveThreadId(null);
    setMissingThreadId(null);
    runtime.thread.reset();
    pushUrl(`/${team}/chat`);
  }, [runtime, team]);

  // Let surfaces outside this provider (e.g. the app icon rail's "New chat"
  // button) start a fresh thread even when already on /chat, where same-route
  // navigation alone wouldn't reset the runtime.
  useEffect(() => {
    const onNew = () => createNewThread();
    window.addEventListener("agentik:new-thread", onNew);
    return () => window.removeEventListener("agentik:new-thread", onNew);
  }, [createNewThread]);

  const selectThread = useCallback(
    (id: string) => {
      if (id === activeRef.current) return;
      setActiveThreadId(id);
      setMissingThreadId(null);
      pushUrl(`/${team}/chat/c/${id}`);
      void loadThread(runtime, id);
    },
    [runtime, team, loadThread],
  );

  const deleteThread = useCallback(
    async (id: string) => {
      setThreads((prev) => prev.filter((t) => t.id !== id));
      try {
        await apiFetch(`/chat/sessions/${id}`, { method: "DELETE", team });
      } catch {
        void refreshList();
      }
      if (activeRef.current === id) createNewThread();
    },
    [team, refreshList, createNewThread],
  );

  const title = useMemo(() => {
    if (missingThreadId) return "Conversation not found";
    return sessionTitle(threads.find((t) => t.id === activeThreadId));
  }, [missingThreadId, threads, activeThreadId]);

  const value = useMemo(
    () => ({
      threads,
      activeThreadId,
      title,
      missingThreadId,
      createNewThread,
      selectThread,
      deleteThread,
    }),
    [threads, activeThreadId, title, missingThreadId, createNewThread, selectThread, deleteThread],
  );

  return (
    <EngineThreadHistoryContext.Provider value={value}>
      {children}
    </EngineThreadHistoryContext.Provider>
  );
}

export function useEngineThreadHistory() {
  const ctx = useContext(EngineThreadHistoryContext);
  if (!ctx)
    throw new Error(
      "useEngineThreadHistory must be used inside EngineThreadHistoryProvider",
    );
  return ctx;
}

export const EngineThreadTitle: FC = () => {
  const { title } = useEngineThreadHistory();
  return <span className="min-w-0 truncate text-sm font-medium">{title}</span>;
};

const DAY_MS = 86_400_000;
function dateGroupLabel(date: Date, startOfToday: number) {
  if (date.getTime() >= startOfToday) return "Today";
  if (date.getTime() >= startOfToday - DAY_MS) return "Yesterday";
  return "Earlier";
}

export const EngineThreadList: FC = () => {
  const { threads, activeThreadId, createNewThread, selectThread, deleteThread } =
    useEngineThreadHistory();

  const groups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const result: Array<{ label: string; items: SessionSummary[] }> = [];
    for (const t of threads) {
      const date = new Date(t.updatedAt);
      const label = dateGroupLabel(Number.isNaN(date.getTime()) ? now : date, startOfToday);
      const group = result.find((g) => g.label === label);
      if (group) group.items.push(t);
      else result.push({ label, items: [t] });
    }
    return result;
  }, [threads]);

  return (
    <div className="aui-root aui-thread-list-root flex flex-col gap-0.5">
      <Button
        variant="ghost"
        className="aui-thread-list-new hover:bg-muted data-active:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal"
        onClick={createNewThread}
      >
        <PlusIcon className="size-4" />
        New Thread
      </Button>

      {groups.map((group) => (
        <div key={group.label} className="contents">
          <div className="aui-thread-list-group-label text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">
            {group.label}
          </div>
          {group.items.map((t) => (
            <div
              key={t.id}
              className={cn(
                "aui-thread-list-item group hover:bg-muted focus-within:bg-muted relative flex h-8 items-center rounded-md transition-colors",
                activeThreadId === t.id && "bg-muted",
              )}
            >
              <button
                className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center px-2.5 pr-9 text-start text-sm"
                type="button"
                onClick={() => selectThread(t.id)}
              >
                <span className="aui-thread-list-item-title min-w-0 flex-1 truncate">
                  {sessionTitle(t)}
                </span>
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="aui-thread-list-item-more absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    type="button"
                    aria-label={`Delete ${sessionTitle(t)}`}
                  >
                    <TrashIcon className="size-3.5" />
                    <MoreHorizontalIcon className="sr-only" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      &ldquo;{sessionTitle(t)}&rdquo; will be permanently removed. This
                      action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                      onClick={() => deleteThread(t.id)}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
