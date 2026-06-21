"use client";

import { useEffect, useState } from "react";
import {
  useAui,
  type LanguageModelConfig,
  type ModelContext,
  type Tool,
} from "@assistant-ui/react";
import { BUILTIN_TOOLS } from "@/lib/tools/catalog";
import {
  executeCustomTool,
  paramsToJsonSchema,
  readCustomTools,
  type CustomTool,
} from "@/lib/tools/custom-tools";

/** Map of disabled built-in tool names, written by the settings Tools section. */
const DISABLED_KEY = "aui:dashboard:enabled-tools";
const CUSTOM_KEY = "aui:dashboard:custom-tools";

function readDisabled(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(DISABLED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Build an assistant-ui frontend tool that runs the custom tool's HTTP call. */
function toFrontendTool(def: CustomTool): Tool<Record<string, unknown>, unknown> {
  return {
    type: "frontend",
    description: def.description,
    parameters: paramsToJsonSchema(def.params),
    execute: (args: Record<string, unknown>) => executeCustomTool(def, args),
  } as Tool<Record<string, unknown>, unknown>;
}

/**
 * Single source that bridges dashboard-settings tool config into the chat model
 * context:
 *  - registers user-created HTTP tools as executable frontend tools, and
 *  - registers `activeTools` so disabled built-ins are withheld from the model.
 *
 * Custom tools are always included in `activeTools` so the built-in whitelist
 * never hides them. When nothing is disabled we omit `activeTools` entirely
 * (full access). `config`/`tools` shallow-merge with the model-picker context.
 */
export function ToolsRegistrar() {
  const aui = useAui();
  const [disabled, setDisabled] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState<CustomTool[]>([]);

  useEffect(() => {
    const sync = () => {
      setDisabled(readDisabled());
      setCustom(readCustomTools());
    };
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === DISABLED_KEY || e.key === CUSTOM_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const validCustom = custom.filter((t) => t.name.trim() && t.url.trim());
    const tools: Record<string, Tool<Record<string, unknown>, unknown>> = {};
    for (const def of validCustom) tools[def.name] = toFrontendTool(def);

    const anyBuiltinDisabled = BUILTIN_TOOLS.some((t) => disabled[t.name]);
    const activeTools = anyBuiltinDisabled
      ? [
          ...BUILTIN_TOOLS.filter((t) => !disabled[t.name]).map((t) => t.name),
          ...validCustom.map((t) => t.name),
        ]
      : undefined;

    if (!validCustom.length && !activeTools) return;

    const context: ModelContext = {
      ...(validCustom.length ? { tools } : {}),
      ...(activeTools
        ? {
            // passthrough field read by /api/chat (not in LanguageModelConfig).
            config: { activeTools } as LanguageModelConfig & { activeTools: string[] },
          }
        : {}),
    };
    return aui.modelContext().register({ getModelContext: () => context });
  }, [aui, disabled, custom]);

  return null;
}
