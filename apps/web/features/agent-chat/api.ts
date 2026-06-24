"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";

export interface ChatSession {
  id: string;
  agentId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  taskId: string | null;
  createdAt: string;
}

export interface ChatSessionDetail {
  session: ChatSession;
  messages: ChatMessage[];
}

export function useChatSessions(team: string) {
  return useQuery({
    queryKey: qk.chat.sessions(team),
    queryFn: ({ signal }) => apiFetch<{ items: ChatSession[] }>("/chat/sessions", { team, signal }),
  });
}

export function useChatSession(team: string, id: string | null) {
  return useQuery({
    queryKey: id ? qk.chat.session(team, id) : ["team", team, "chat", "session", "none"],
    queryFn: ({ signal }) => apiFetch<ChatSessionDetail>(`/chat/sessions/${id}`, { team, signal }),
    enabled: !!id,
  });
}

export function useCreateChatSession(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { agentId: string; title?: string }) =>
      apiFetch<ChatSession>("/chat/sessions", { method: "POST", team, body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.chat.sessions(team) }),
  });
}

export function useSendChatMessage(team: string, sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<{ taskId: string }>(`/chat/sessions/${sessionId}/messages`, { method: "POST", team, body: { content } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.chat.session(team, sessionId) });
      qc.invalidateQueries({ queryKey: qk.chat.sessions(team) });
    },
  });
}
