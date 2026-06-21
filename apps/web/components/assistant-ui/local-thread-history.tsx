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
import { useDemoRuntime } from "@/components/runtime/demo-runtime-provider";
import { cn } from "@/lib/utils";

type StoredThread = {
  id: string;
  title: string;
  lastMessageAt: string;
  externalState?: unknown;
  repository: {
    headId?: string | null;
    messages: Array<{
      parentId: string | null;
      message: Record<string, unknown>;
      runConfig?: unknown;
    }>;
  };
};

type StoredThreadState = {
  activeThreadId: string | null;
  threads: StoredThread[];
};

type LocalThreadHistoryContextValue = {
  threads: StoredThread[];
  activeThreadId: string | null;
  title: string;
  createNewThread: () => void;
  selectThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
};

const LocalThreadHistoryContext = createContext<LocalThreadHistoryContextValue | null>(null);

const STORAGE_KEY = "agentik:assistant-ui-base:thread-history:v1";

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

function reviveMessage(value: unknown): Record<string, unknown> {
  const message = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
  const createdAt = message.createdAt;
  message.createdAt =
    createdAt instanceof Date ? createdAt : typeof createdAt === "string" || typeof createdAt === "number" ? new Date(createdAt) : new Date();

  if (Array.isArray(message.content)) {
    message.content = message.content.map((part) => {
      if (!part || typeof part !== "object") return part;
      const nextPart = { ...(part as Record<string, unknown>) };
      if (Array.isArray(nextPart.messages)) {
        nextPart.messages = nextPart.messages.map(reviveMessage);
      }
      return nextPart;
    });
  }

  return message;
}

function reviveLinearMessages(repository: StoredThread["repository"]) {
  return repository.messages.map((item) => reviveMessage(item.message)) as unknown as Parameters<
    AssistantRuntime["thread"]["reset"]
  >[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRestorableExternalState(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.messages)) return false;

  return value.messages.every((item) => {
    if (!isRecord(item) || !isRecord(item.message)) return false;
    const { parentId, message } = item;
    const role = message.role;
    return (
      (parentId === null || parentId === undefined || typeof parentId === "string") &&
      typeof role === "string" &&
      Array.isArray(message.parts)
    );
  });
}

function repositoryToExternalState(repository: StoredThread["repository"]) {
  if (repository.messages.length === 0) return undefined;

  const messages = repository.messages
    .map((item) => {
      const message = reviveMessage(item.message);
      const id = message.id;
      const role = message.role;
      if (typeof id !== "string" || typeof role !== "string") return null;

      const content = Array.isArray(message.content) ? message.content : [];
      const parts = content
        .map((part) => {
          if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return null;
          return { type: "text", text: part.text };
        })
        .filter((part): part is { type: "text"; text: string } => Boolean(part));

      return {
        parentId: typeof item.parentId === "string" ? item.parentId : null,
        message: {
          id,
          role,
          parts,
          metadata: isRecord(message.metadata) ? message.metadata : { custom: {} },
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (messages.length === 0) return undefined;
  return {
    messages,
    headId: typeof repository.headId === "string" ? repository.headId : messages.at(-1)?.message.id,
  };
}

function restoreThread(runtime: AssistantRuntime, thread: StoredThread) {
  try {
    if (isRestorableExternalState(thread.externalState)) {
      runtime.thread.importExternalState(thread.externalState);
      return;
    }

    const legacyExternalState = repositoryToExternalState(thread.repository);
    if (legacyExternalState) {
      runtime.thread.importExternalState(legacyExternalState);
      return;
    }

    runtime.thread.reset(reviveLinearMessages(thread.repository));
  } catch (error) {
    console.warn("[assistant-ui] Failed to restore local thread history; starting a clean thread.", error);
    runtime.thread.reset();
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
              (thread as StoredThread).repository &&
              Array.isArray((thread as StoredThread).repository.messages),
          );
        })
        .map((thread) => ({
          ...thread,
          externalState: isRestorableExternalState(thread.externalState) ? thread.externalState : undefined,
        }))
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

export function LocalThreadHistoryProvider({ children }: { children: ReactNode }) {
  const runtime = useDemoRuntime();
  const aui = runtime;
  const messages = useAuiState((state) => state.thread.messages);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const restoringRef = useRef(false);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? normalizeStoredState(JSON.parse(raw)) : { activeThreadId: null, threads: [] };
      setThreads(stored.threads);
      setActiveThreadId(stored.activeThreadId);

      const activeThread = stored.threads.find((thread) => thread.id === stored.activeThreadId);
      if (activeThread) {
        restoringRef.current = true;
        restoreThread(aui, activeThread);
        window.setTimeout(() => {
          restoringRef.current = false;
        }, 0);
      }
    } catch {
      setThreads([]);
      setActiveThreadId(null);
    } finally {
      setHydrated(true);
    }
  }, [aui]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeThreadId, threads }));
    } catch {
      // Storage can be disabled; the current in-memory session still works.
    }
  }, [activeThreadId, hydrated, threads]);

  useEffect(() => {
    if (!hydrated || restoringRef.current || messages.length === 0) return;

    const repository = aui.thread.export();
    const externalState = aui.thread.exportExternalState();
    if (repository.messages.length === 0) return;

    const id = activeThreadIdRef.current ?? `thread-${Date.now()}`;
    if (!activeThreadIdRef.current) {
      activeThreadIdRef.current = id;
      setActiveThreadId(id);
    }

    const title = deriveThreadTitle(messages);
    const lastMessageAt = getLastMessageAt(messages);
    const nextThread: StoredThread = { id, title, lastMessageAt, externalState, repository };

    setThreads((previous) => [nextThread, ...previous.filter((thread) => thread.id !== id)].slice(0, 50));
  }, [aui, hydrated, messages, isRunning]);

  const createNewThread = useCallback(() => {
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    restoringRef.current = true;
    aui.thread.reset();
    window.setTimeout(() => {
      restoringRef.current = false;
    }, 0);
  }, [aui]);

  const selectThread = useCallback(
    (threadId: string) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) return;
      activeThreadIdRef.current = thread.id;
      setActiveThreadId(thread.id);
      restoringRef.current = true;
      restoreThread(aui, thread);
      window.setTimeout(() => {
        restoringRef.current = false;
      }, 0);
    },
    [aui, threads],
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
    if (messages.length > 0) return deriveThreadTitle(messages);
    const activeThread = threads.find((thread) => thread.id === activeThreadId);
    return activeThread?.title ?? "New Chat";
  }, [activeThreadId, messages, threads]);

  const value = useMemo(
    () => ({ threads, activeThreadId, title, createNewThread, selectThread, deleteThread }),
    [activeThreadId, createNewThread, deleteThread, selectThread, threads, title],
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
                <button
                  className="aui-thread-list-item-more absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  type="button"
                  aria-label={`Delete ${thread.title}`}
                  onClick={() => deleteThread(thread.id)}
                >
                  <TrashIcon className="size-3.5" />
                  <MoreHorizontalIcon className="sr-only" />
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};
