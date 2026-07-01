import { createStore } from "zustand/vanilla";
import type {
  AgentConfig,
  ModelConfig,
  AgentLimits,
  RetryPolicy,
  Guardrails,
  ToolGrant,
  MemoryBinding,
  PromptVariable,
  RuntimeKind,
} from "@/types/domain";
import { normalizeAgentConfig, modelDefaultForRuntime } from "./default-config";
import type { BuilderSectionKey, DraftIdentity } from "./validation";

export type SaveState = "idle" | "dirty" | "saving" | "saved";

export interface BuilderState {
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
  setRuntimeKind: (runtimeKind: RuntimeKind) => void;
  setRuntimeBinding: (daemonId: string | null) => void;
  patchModel: (patch: Partial<ModelConfig>) => void;
  patchLimits: (patch: Partial<AgentLimits>) => void;
  patchRetry: (patch: Partial<RetryPolicy>) => void;
  patchGuardrails: (patch: Partial<Guardrails>) => void;
  setSystemPrompt: (prompt: string) => void;
  setPromptVariables: (vars: PromptVariable[]) => void;
  setTools: (tools: ToolGrant[]) => void;
  setMemory: (memory: MemoryBinding[]) => void;
}

const EMPTY_IDENTITY: DraftIdentity = { name: "", role: "", goal: "" };

export type BuilderStore = ReturnType<typeof createBuilderStore>;

/**
 * Context-scoped store factory. Each `AgentBuilder` mount owns its own store
 * instance (see store-context.tsx) so create-mode and edit-mode — or two agents
 * edited in sequence — never leak state into each other. (The old module-level
 * singleton silently shared state across every mount.)
 */
export function createBuilderStore(
  initialIdentity?: Partial<DraftIdentity>,
  initialConfig?: AgentConfig,
) {
  return createStore<BuilderState>((set) => ({
    identity: { ...EMPTY_IDENTITY, ...initialIdentity },
    config: normalizeAgentConfig(initialConfig),
    activeSection: "persona",
    saveState: "idle",
    rev: 0,

    init: (identity, config) =>
      set({
        identity: { ...EMPTY_IDENTITY, ...identity },
        config: normalizeAgentConfig(config),
        activeSection: "persona",
        saveState: "idle",
        rev: 0,
      }),

    setActiveSection: (activeSection) => set({ activeSection }),
    setSaveState: (saveState) => set({ saveState }),

    patchIdentity: (patch) =>
      set((s) => ({ identity: { ...s.identity, ...patch }, rev: s.rev + 1, saveState: "dirty" })),
    setRuntimeKind: (runtimeKind) =>
      set((s) => ({
        config: {
          ...s.config,
          runtimeKind,
          runtimeBinding: { daemonId: null },
          // Model follows the runtime: switching to openai/google/claude resets the
          // provider + default model to a matching one (keeps temperature/etc.).
          model: { ...s.config.model, ...modelDefaultForRuntime(runtimeKind) },
        },
        rev: s.rev + 1,
        saveState: "dirty",
      })),
    setRuntimeBinding: (daemonId) =>
      set((s) => ({
        config: { ...s.config, runtimeBinding: { daemonId } },
        rev: s.rev + 1,
        saveState: "dirty",
      })),
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
    setPromptVariables: (promptVariables) =>
      set((s) => ({ config: { ...s.config, promptVariables }, rev: s.rev + 1, saveState: "dirty" })),
    setTools: (tools) => set((s) => ({ config: { ...s.config, tools }, rev: s.rev + 1, saveState: "dirty" })),
    setMemory: (memory) => set((s) => ({ config: { ...s.config, memory }, rev: s.rev + 1, saveState: "dirty" })),
  }));
}
