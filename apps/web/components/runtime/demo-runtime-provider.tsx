"use client";

import { createContext, useContext } from "react";
import { AssistantRuntimeProvider, type AssistantRuntime } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";

const DemoRuntimeContext = createContext<AssistantRuntime | null>(null);

export function useDemoRuntime() {
  const runtime = useContext(DemoRuntimeContext);
  if (!runtime) throw new Error("useDemoRuntime must be used inside DemoRuntimeProvider");
  return runtime;
}

export function DemoRuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" }),
  });

  return (
    <DemoRuntimeContext.Provider value={runtime}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </DemoRuntimeContext.Provider>
  );
}
