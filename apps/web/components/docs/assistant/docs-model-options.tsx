"use client";

/* eslint-disable @next/next/no-img-element */

import type { ModelOption } from "@/components/assistant-ui/model-selector";

const iconBaseUrl = "https://www.assistant-ui.com/icons";

function ModelIcon({ name, icon }: { name: string; icon: string }) {
  return <img className="size-4" src={`${iconBaseUrl}/${icon}`} alt={name} />;
}

export function docsModelOptions(): ModelOption[] {
  return [
    {
      id: "gpt-4.1-mini",
      name: "GPT-5.4 Nano",
      icon: <ModelIcon name="OpenAI" icon="openai.svg" />,
      keywords: ["openai", "gpt"],
    },
    {
      id: "gpt-4.1",
      name: "GPT-5.4 Mini",
      icon: <ModelIcon name="OpenAI" icon="openai.svg" />,
      keywords: ["openai", "gpt"],
    },
    {
      id: "gemini-flash-lite",
      name: "Gemini 3.1 Flash Lite",
      icon: <ModelIcon name="Google" icon="google.svg" />,
      keywords: ["google", "gemini"],
    },
    {
      id: "grok-fast",
      name: "Grok 4.1 Fast",
      icon: <ModelIcon name="xAI" icon="xai.svg" />,
      keywords: ["xai", "grok"],
    },
    {
      id: "grok-mini",
      name: "Grok 3 Mini",
      icon: <ModelIcon name="xAI" icon="xai.svg" />,
      keywords: ["xai", "grok"],
    },
    {
      id: "llama-scout",
      name: "Llama 4 Scout 17B",
      icon: <ModelIcon name="Meta" icon="meta.svg" />,
      keywords: ["meta", "llama"],
    },
    {
      id: "qwen3-32b",
      name: "Qwen3 32B",
      icon: <ModelIcon name="Groq" icon="groq.svg" />,
      keywords: ["groq", "qwen"],
    },
  ];
}
