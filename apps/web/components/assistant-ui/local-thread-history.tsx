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
import { useAuiState, type AssistantRuntime } from "@assistant-ui/react";
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
import { useDemoRuntime } from "@/components/runtime/demo-runtime-provider";
import { cn } from "@/lib/utils";

// The runtime's own serialization format (assistant-ui external state). We persist
// exactly what `thread.exportExternalState()` returns and feed it back verbatim to
// `thread.importExternalState()` so the round-trip is guaranteed to match.
type StoredExternalState = {
  messages: unknown[];
  headId?: string | null;
};

type StoredThread = {
  id: string;
  title: string;
  lastMessageAt: string;
  externalState: StoredExternalState;
};

type StoredThreadState = {
  activeThreadId: string | null;
  threads: StoredThread[];
};

type LocalThreadHistoryContextValue = {
  threads: StoredThread[];
  activeThreadId: string | null;
  title: string;
  missingThreadId: string | null;
  createNewThread: () => void;
  selectThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
};

const LocalThreadHistoryContext = createContext<LocalThreadHistoryContextValue | null>(null);

const STORAGE_KEY = "agentik:assistant-ui-base:thread-history:v2";

function pushBrowserUrl(href: string) {
  if (window.location.pathname === href) return;
  window.history.pushState(null, "", href);
}

function replaceBrowserUrl(href: string) {
  if (window.location.pathname === href) return;
  window.history.replaceState(null, "", href);
}

function persistStoredState(state: StoredThreadState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be disabled; the current in-memory session still works.
  }
}

function getMessageText(message: unknown) {
  if (!message || typeof message !== "object") return "";
  const candidate = message as { content?: unknown; parts?: unknown };
  const content = Array.isArray(candidate.content) ? candidate.content : Array.isArray(candidate.parts) ? candidate.parts : [];

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ((part as { type?: unknown }).type !== "text") return "";
      return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveThreadTitle(messages: readonly unknown[]) {
  const firstUserMessage = messages.find((message) => {
    return Boolean(message && typeof message === "object" && (message as { role?: unknown }).role === "user");
  });
  const text = getMessageText(firstUserMessage);
  if (!text) return "New Chat";

  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? text;
  const normalized = firstLine.replace(/^[@/]\S+\s*/, "").trim() || firstLine;
  if (normalized.toLowerCase() === "hello") return "User Greeting";
  return normalized;
}

function getLastMessageAt(messages: readonly unknown[]) {
  const last = messages.at(-1);
  const createdAt = last && typeof last === "object" ? (last as { createdAt?: unknown }).createdAt : undefined;
  const date = createdAt instanceof Date ? createdAt : typeof createdAt === "string" ? new Date(createdAt) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function isStoredExternalState(value: unknown): value is StoredExternalState {
  return Boolean(value && typeof value === "object" && Array.isArray((value as StoredExternalState).messages));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Serialize the live thread messages into the runtime's external-state shape
// ({ messages: [{ parentId, message }], headId }) where each `message` is an
// AI SDK UIMessage. We read from `getState().messages` (which contains both the
// user prompt and the streamed assistant reply) rather than the runtime's own
// `exportExternalState()`, which omits streamed assistant messages for the AI SDK
// runtime. The result round-trips through `importExternalState()`.
function exportThreadState(runtime: AssistantRuntime): StoredExternalState | null {
  const messages = runtime.thread.getState().messages as readonly unknown[];

  const stored: Array<{ parentId: string | null; message: { id: string; role: string; parts: Array<{ type: string; text: string }>; metadata: Record<string, unknown> } }> = [];
  // Chain messages linearly: each message's parent is the previous kept message.
  // The live thread state does not expose parent ids, so reconstructing the chain
  // from order is what makes the conversation import as one thread instead of
  // sibling branches (only the head branch would otherwise render).
  let parentId: string | null = null;

  for (const entry of messages) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.role !== "string") continue;

    const rawParts = Array.isArray(entry.content)
      ? entry.content
      : Array.isArray((entry as { parts?: unknown }).parts)
        ? (entry as { parts: unknown[] }).parts
        : [];

    const parts = rawParts
      .map((part) => {
        if (!isRecord(part)) return null;
        if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string" && part.text.length > 0) {
          return { type: part.type, text: part.text };
        }
        return null;
      })
      .filter((part): part is { type: string; text: string } => Boolean(part));

    if (parts.length === 0) continue;

    stored.push({
      parentId,
      message: {
        id: entry.id,
        role: entry.role,
        parts,
        metadata: isRecord(entry.metadata) ? entry.metadata : { custom: {} },
      },
    });
    parentId = entry.id;
  }

  if (stored.length === 0) return null;

  return { messages: stored, headId: stored.at(-1)!.message.id };
}

function restoreThread(runtime: AssistantRuntime, thread: StoredThread) {
  try {
    runtime.thread.importExternalState(thread.externalState);
  } catch (error) {
    console.warn("[assistant-ui] Failed to restore local thread history; starting a clean thread.", error);
    try {
      runtime.thread.importExternalState({ messages: [] });
    } catch {
      // If even the empty import fails the runtime is in a state we can't recover here.
    }
  }
}

function normalizeStoredState(value: unknown): StoredThreadState {
  if (!value || typeof value !== "object") return { activeThreadId: null, threads: [] };
  const candidate = value as { activeThreadId?: unknown; threads?: unknown };
  const activeThreadId = typeof candidate.activeThreadId === "string" ? candidate.activeThreadId : null;
  const threads = Array.isArray(candidate.threads)
    ? candidate.threads
        .filter((thread): thread is StoredThread => {
          return Boolean(
            thread &&
              typeof thread === "object" &&
              typeof (thread as StoredThread).id === "string" &&
              typeof (thread as StoredThread).title === "string" &&
              typeof (thread as StoredThread).lastMessageAt === "string" &&
              isStoredExternalState((thread as StoredThread).externalState),
          );
        })
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
        .slice(0, 50)
    : [];

  return {
    activeThreadId: threads.some((thread) => thread.id === activeThreadId) ? activeThreadId : null,
    threads,
  };
}

function dateGroupLabel(date: Date, startOfToday: number) {
  const day = 86_400_000;
  if (date.getTime() >= startOfToday) return "Today";
  if (date.getTime() >= startOfToday - day) return "Yesterday";
  return "Earlier";
}

export function LocalThreadHistoryProvider({
  children,
  routeThreadId,
  team,
}: {
  children: ReactNode;
  routeThreadId?: string;
  team: string;
}) {
  const runtime = useDemoRuntime();
  const aui = runtime;
  const messages = useAuiState((state) => state.thread.messages);
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [missingThreadId, setMissingThreadId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const dashboardHref = useMemo(() => `/${encodeURIComponent(team)}/thechat`, [team]);
  const threadHref = useCallback(
    (threadId: string) => `${dashboardHref}/c/${encodeURIComponent(threadId)}`,
    [dashboardHref],
  );

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? normalizeStoredState(JSON.parse(raw)) : { activeThreadId: null, threads: [] };
      setThreads(stored.threads);
      const nextActiveThreadId = routeThreadId ?? null;
      activeThreadIdRef.current = nextActiveThreadId;
      setActiveThreadId(nextActiveThreadId);

      const activeThread = routeThreadId ? stored.threads.find((thread) => thread.id === routeThreadId) : null;
      setMissingThreadId(routeThreadId && !activeThread ? routeThreadId : null);
      restoringRef.current = true;
      if (activeThread) restoreThread(aui, activeThread);
      else aui.thread.reset();
      window.setTimeout(() => {
        restoringRef.current = false;
      }, 0);
    } catch {
      setThreads([]);
      setActiveThreadId(null);
      setMissingThreadId(routeThreadId ?? null);
      activeThreadIdRef.current = null;
      restoringRef.current = true;
      aui.thread.reset();
      window.setTimeout(() => {
        restoringRef.current = false;
      }, 0);
    } finally {
      setHydrated(true);
    }
  }, [aui, routeThreadId]);

  useEffect(() => {
    if (!hydrated) return;
    const storedActiveThreadId = threads.some((thread) => thread.id === activeThreadId) ? activeThreadId : null;
    persistStoredState({ activeThreadId: storedActiveThreadId, threads });
  }, [activeThreadId, hydrated, threads]);

  const persistCurrentThread = useCallback(() => {
    if (!hydrated || restoringRef.current) return;

    const threadMessages = aui.thread.getState().messages;
    if (threadMessages.length === 0) return;

    const externalState = exportThreadState(aui);
    if (!externalState || externalState.messages.length === 0) return;

    const shouldRouteNewThread = !activeThreadIdRef.current && !routeThreadId;
    const id = activeThreadIdRef.current ?? routeThreadId ?? `thread-${Date.now()}`;
    if (!activeThreadIdRef.current) {
      activeThreadIdRef.current = id;
      setActiveThreadId(id);
    }

    const title = deriveThreadTitle(threadMessages);
    const lastMessageAt = getLastMessageAt(threadMessages);
    const nextThread: StoredThread = { id, title, lastMessageAt, externalState };
    setMissingThreadId(null);

    setThreads((previous) => {
      const previousThread = previous.find((thread) => thread.id === id);

      if (previousThread) {
        // Transient shorter state during restore: don't clobber the fuller stored one.
        if (externalState.messages.length < previousThread.externalState.messages.length) {
          return previous;
        }
        // No new message (e.g. just selecting/restoring a conversation): update in
        // place so switching threads in the sidebar never reorders the list.
        if (externalState.messages.length === previousThread.externalState.messages.length) {
          const nextThreads = previous.map((thread) => (thread.id === id ? nextThread : thread));
          persistStoredState({ activeThreadId: id, threads: nextThreads });
          return nextThreads;
        }
      }

      // New thread, or a new message arrived → surface it at the top.
      const nextThreads = [nextThread, ...previous.filter((thread) => thread.id !== id)].slice(0, 50);
      persistStoredState({ activeThreadId: id, threads: nextThreads });
      return nextThreads;
    });

    if (shouldRouteNewThread) replaceBrowserUrl(threadHref(id));
  }, [aui, hydrated, routeThreadId, threadHref]);

  useEffect(() => {
    if (!hydrated) return;

    let timeout: number | undefined;
    const schedulePersist = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(persistCurrentThread, 150);
    };

    schedulePersist();
    const unsubscribe = aui.thread.subscribe(schedulePersist);

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [aui, hydrated, persistCurrentThread]);

  const createNewThread = useCallback(() => {
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    setMissingThreadId(null);
    restoringRef.current = true;
    aui.thread.reset();
    window.setTimeout(() => {
      restoringRef.current = false;
    }, 0);
    pushBrowserUrl(dashboardHref);
  }, [aui, dashboardHref]);

  const selectThread = useCallback(
    (threadId: string) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) return;
      activeThreadIdRef.current = thread.id;
      setActiveThreadId(thread.id);
      setMissingThreadId(null);
      restoringRef.current = true;
      restoreThread(aui, thread);
      window.setTimeout(() => {
        restoringRef.current = false;
      }, 0);
      pushBrowserUrl(threadHref(thread.id));
    },
    [aui, threadHref, threads],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      setThreads((previous) => previous.filter((thread) => thread.id !== threadId));
      if (activeThreadIdRef.current === threadId) {
        createNewThread();
      }
    },
    [createNewThread],
  );

  const title = useMemo(() => {
    if (missingThreadId) return "Conversation not found";
    if (messages.length > 0) return deriveThreadTitle(messages);
    const activeThread = threads.find((thread) => thread.id === activeThreadId);
    return activeThread?.title ?? "New Chat";
  }, [activeThreadId, messages, missingThreadId, threads]);

  const value = useMemo(
    () => ({ threads, activeThreadId, title, missingThreadId, createNewThread, selectThread, deleteThread }),
    [activeThreadId, createNewThread, deleteThread, missingThreadId, selectThread, threads, title],
  );

  return <LocalThreadHistoryContext.Provider value={value}>{children}</LocalThreadHistoryContext.Provider>;
}

export function useLocalThreadHistory() {
  const context = useContext(LocalThreadHistoryContext);
  if (!context) throw new Error("useLocalThreadHistory must be used inside LocalThreadHistoryProvider");
  return context;
}

export const LocalThreadTitle: FC = () => {
  const { title } = useLocalThreadHistory();
  return <span className="min-w-0 truncate text-sm font-medium">{title}</span>;
};

export const LocalThreadList: FC = () => {
  const { threads, activeThreadId, createNewThread, selectThread, deleteThread } = useLocalThreadHistory();

  const groups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const result: Array<{ label: string; threads: StoredThread[] }> = [];

    for (const thread of threads) {
      const date = new Date(thread.lastMessageAt);
      const label = dateGroupLabel(Number.isNaN(date.getTime()) ? new Date() : date, startOfToday);
      const group = result.find((candidate) => candidate.label === label);
      if (group) group.threads.push(thread);
      else result.push({ label, threads: [thread] });
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

      {groups.length === 0 ? null : (
        groups.map((group) => (
          <div key={group.label} className="contents">
            <div className="aui-thread-list-group-label text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">
              {group.label}
            </div>
            {group.threads.map((thread) => (
              <div
                key={thread.id}
                className={cn(
                  "aui-thread-list-item group hover:bg-muted focus-within:bg-muted relative flex h-8 items-center rounded-md transition-colors",
                  activeThreadId === thread.id && "bg-muted",
                )}
              >
                <button
                  className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center px-2.5 pr-9 text-start text-sm"
                  type="button"
                  onClick={() => selectThread(thread.id)}
                >
                  <span className="aui-thread-list-item-title min-w-0 flex-1 truncate">{thread.title}</span>
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="aui-thread-list-item-more absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                      type="button"
                      aria-label={`Delete ${thread.title}`}
                    >
                      <TrashIcon className="size-3.5" />
                      <MoreHorizontalIcon className="sr-only" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                      <AlertDialogDescription>
                        &ldquo;{thread.title}&rdquo; will be permanently removed from this browser. This
                        action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                        onClick={() => deleteThread(thread.id)}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};
