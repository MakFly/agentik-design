"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Bot, Loader2, MessageSquarePlus, Send, User } from "lucide-react";
import { qk } from "@/lib/api/queryKeys";
import { realtime } from "@/lib/realtime/ws-client";
import { useAgents } from "@/features/agent-registry/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useChatSession, useChatSessions, useCreateChatSession, useSendChatMessage } from "./api";

/**
 * Real agent-task chat: each user turn enqueues a `kind='chat'` agent task on the
 * engine; the assistant turn lands when the task completes (live via the chat.message
 * realtime event, with a refetch fallback). No demo runtime — this drives the daemon.
 */
export function AgentChat({ team }: { team: string }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Task currently awaiting a reply (drives the thinking indicator); cleared when the
  // assistant turn lands or the run fails — so a failed run never spins forever.
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const agents = useAgents(team);
  const sessions = useChatSessions(team);
  const session = useChatSession(team, activeId);
  const createSession = useCreateChatSession(team);
  const sendMessage = useSendChatMessage(team, activeId ?? "");

  // Reset the per-conversation transient state when switching sessions.
  useEffect(() => {
    setPendingTaskId(null);
    setRunError(null);
  }, [activeId]);

  // Realtime: a reply landing clears the spinner; a run failure surfaces an error
  // (a failed task writes no assistant turn, so without this the UI would hang).
  useEffect(() => {
    const unsub = realtime.subscribe((e) => {
      if (e.kind === "chat.message" && e.sessionId === activeId) {
        qc.invalidateQueries({ queryKey: qk.chat.session(team, e.sessionId) });
        setPendingTaskId(null);
        setRunError(null);
      }
      if (e.kind === "run" && pendingTaskId && e.runId === pendingTaskId) {
        if (e.action === "succeeded") {
          qc.invalidateQueries({ queryKey: qk.chat.session(team, activeId!) });
        } else if (e.action === "failed" || e.action === "cancelled") {
          setPendingTaskId(null);
          setRunError(e.action === "cancelled" ? "Run cancelled." : "The agent run failed — see Executions for details.");
        }
      }
    });
    return unsub;
  }, [team, activeId, pendingTaskId, qc]);

  const messages = session.data?.messages ?? [];
  const awaitingReply = !!pendingTaskId;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <SessionSidebar
        agents={agents.data?.items ?? []}
        agentsLoading={agents.isLoading}
        sessions={sessions.data?.items ?? []}
        activeId={activeId}
        creating={createSession.isPending}
        onSelect={setActiveId}
        onCreate={(agentId) =>
          createSession.mutate(
            { agentId },
            {
              onSuccess: (s) => setActiveId(s.id),
              onError: () => toast.error("Could not start a conversation"),
            },
          )
        }
      />

      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {!activeId ? (
          <div className="grid flex-1 place-items-center p-6">
            <EmptyState icon={MessageSquarePlus} title="No conversation" description="Pick an agent on the left and start chatting." />
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-4 p-4">
                {session.isLoading ? (
                  <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
                ) : messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Say hello to get started.</p>
                ) : (
                  messages.map((m) => <Bubble key={m.id} role={m.role} content={m.content} />)
                )}
                {awaitingReply && <Bubble role="assistant" content="" pending />}
                {runError && (
                  <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                    <AlertCircle className="size-4 shrink-0" />
                    {runError}
                  </div>
                )}
              </div>
            </ScrollArea>
            <Composer
              disabled={!activeId}
              onSend={(text) => {
                setRunError(null);
                sendMessage.mutate(text, {
                  onSuccess: (res) => setPendingTaskId(res.taskId),
                  onError: () => setRunError("Could not send the message."),
                });
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}

function SessionSidebar({
  agents,
  agentsLoading,
  sessions,
  activeId,
  creating,
  onSelect,
  onCreate,
}: {
  agents: Array<{ id: string; name: string }>;
  agentsLoading: boolean;
  sessions: Array<{ id: string; title: string; agentId: string; updatedAt: string }>;
  activeId: string | null;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreate: (agentId: string) => void;
}) {
  const [agentId, setAgentId] = useState<string>("");
  const agentName = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-2">
        <Select value={agentId} onValueChange={setAgentId} disabled={agentsLoading || agents.length === 0}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={agentsLoading ? "Loading agents…" : agents.length ? "Pick an agent" : "No agents"} />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!agentId || creating} onClick={() => onCreate(agentId)}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />}
          New conversation
        </Button>
      </div>

      <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Conversations</div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1">
          {sessions.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">None yet.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={cn(
                  "truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2",
                  s.id === activeId && "bg-surface-2 font-medium",
                )}
              >
                {s.title || agentName.get(s.agentId) || "Conversation"}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function Bubble({ role, content, pending }: { role: string; content: string; pending?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn("grid size-7 shrink-0 place-items-center rounded-full", isUser ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted-foreground")}>
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className={cn("max-w-[75%] rounded-2xl px-3 py-2 text-sm", isUser ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground")}>
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <span className="whitespace-pre-wrap">{content}</span>}
      </div>
    </div>
  );
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
    ref.current?.focus();
  };

  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Message the agent…   (Enter to send, Shift+Enter for newline)"
        rows={1}
        className="max-h-40 min-h-10 flex-1 resize-none"
      />
      <Button size="icon" disabled={disabled || !text.trim()} onClick={submit} aria-label="Send message">
        <Send className="size-4" />
      </Button>
    </div>
  );
}
