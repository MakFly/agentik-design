import { create } from "zustand";
import type { AgentConfig, ModelConfig, AgentLimits, RetryPolicy, Guardrails, ToolGrant, MemoryBinding } from "@/types/domain";
import { defaultAgentConfig } from "./default-config";
import type { BuilderSectionKey, DraftIdentity } from "./validation";

export type SaveState = "idle" | "dirty" | "saving" | "saved";

interface BuilderState {
  identity: DraftIdentity;
  config: AgentConfig;
  activeSection: BuilderSectionKey;
  saveState: SaveState;
  /** monotonic counter so the autosave effect can debounce on real changes */
  rev: number;

  init: (identity?: Partial<DraftIdentity>, config?: AgentConfig) => void;
  setActiveSection: (s: BuilderSectionKey) => void;
  setSaveState: (s: SaveState) => void;

  patchIdentity: (patch: Partial<DraftIdentity>) => void;
  patchModel: (patch: Partial<ModelConfig>) => void;
  patchLimits: (patch: Partial<AgentLimits>) => void;
  patchRetry: (patch: Partial<RetryPolicy>) => void;
  patchGuardrails: (patch: Partial<Guardrails>) => void;
  setSystemPrompt: (prompt: string) => void;
  setTools: (tools: ToolGrant[]) => void;
  setMemory: (memory: MemoryBinding[]) => void;
}

const EMPTY_IDENTITY: DraftIdentity = { name: "", role: "", goal: "" };

export const useBuilderStore = create<BuilderState>((set) => ({
  identity: EMPTY_IDENTITY,
  config: defaultAgentConfig(),
  activeSection: "identity",
  saveState: "idle",
  rev: 0,

  init: (identity, config) =>
    set({
      identity: { ...EMPTY_IDENTITY, ...identity },
      config: config ?? defaultAgentConfig(),
      activeSection: "identity",
      saveState: "idle",
      rev: 0,
    }),

  setActiveSection: (activeSection) => set({ activeSection }),
  setSaveState: (saveState) => set({ saveState }),

  patchIdentity: (patch) =>
    set((s) => ({ identity: { ...s.identity, ...patch }, rev: s.rev + 1, saveState: "dirty" })),
  patchModel: (patch) =>
    set((s) => ({ config: { ...s.config, model: { ...s.config.model, ...patch } }, rev: s.rev + 1, saveState: "dirty" })),
  patchLimits: (patch) =>
    set((s) => ({ config: { ...s.config, limits: { ...s.config.limits, ...patch } }, rev: s.rev + 1, saveState: "dirty" })),
  patchRetry: (patch) =>
    set((s) => ({ config: { ...s.config, retry: { ...s.config.retry, ...patch } }, rev: s.rev + 1, saveState: "dirty" })),
  patchGuardrails: (patch) =>
    set((s) => ({ config: { ...s.config, guardrails: { ...s.config.guardrails, ...patch } }, rev: s.rev + 1, saveState: "dirty" })),
  setSystemPrompt: (systemPrompt) =>
    set((s) => ({ config: { ...s.config, systemPrompt }, rev: s.rev + 1, saveState: "dirty" })),
  setTools: (tools) => set((s) => ({ config: { ...s.config, tools }, rev: s.rev + 1, saveState: "dirty" })),
  setMemory: (memory) => set((s) => ({ config: { ...s.config, memory }, rev: s.rev + 1, saveState: "dirty" })),
}));
