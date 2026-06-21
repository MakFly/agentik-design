import { apiFetch } from "@/lib/api/client";
import type {
  HermesChatRequest,
  HermesChatResponse,
  HermesRunRequest,
  HermesRunResult,
  NotificationConfig,
  NotificationResult,
} from "./types";

export function runHermesLite(payload: HermesRunRequest) {
  return apiFetch<HermesRunResult>("/hermes-lite/run", {
    method: "POST",
    body: payload,
  });
}

export function chatHermesLite(payload: HermesChatRequest) {
  return apiFetch<HermesChatResponse>("/hermes-lite/chat", {
    method: "POST",
    body: payload,
  });
}

export function testNotifications(payload: {
  config: NotificationConfig;
  title: string;
  summary: string;
}) {
  return apiFetch<{ results: NotificationResult[] }>("/notifications/test", {
    method: "POST",
    body: payload,
  });
}
