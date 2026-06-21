"use client";

import { createContext, useContext } from "react";
import { AssistantRuntimeProvider, type AssistantRuntime } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { WeatherToolUI } from "@/components/assistant-ui/tools/weather-tool-ui";
import { ToolsRegistrar } from "@/components/runtime/tools-registrar";

const DemoRuntimeContext = createContext<AssistantRuntime | null>(null);

export function useDemoRuntime() {
  const runtime = useContext(DemoRuntimeContext);
  if (!runtime) throw new Error("useDemoRuntime must be used inside DemoRuntimeProvider");
  return runtime;
}

export function DemoRuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" }),
    // After a client-side (frontend) tool runs, auto-resubmit its result so the
    // model can continue and answer. Server-side tools continue via stopWhen.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  return (
    <DemoRuntimeContext.Provider value={runtime}>
      <AssistantRuntimeProvider runtime={runtime}>
        {/* Registers the get_weather tool-call renderer into the model context. */}
        <WeatherToolUI />
        {/* Registers custom HTTP tools + activeTools from dashboard settings. */}
        <ToolsRegistrar />
        {children}
      </AssistantRuntimeProvider>
    </DemoRuntimeContext.Provider>
  );
}
