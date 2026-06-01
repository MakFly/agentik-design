import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Env } from "@/types/domain";

export type Density = "compact" | "comfortable";

interface UiState {
  sidebarCollapsed: boolean;
  density: Density;
  commandOpen: boolean;
  env: Env;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setDensity: (d: Density) => void;
  toggleDensity: () => void;
  setCommandOpen: (v: boolean) => void;
  setEnv: (e: Env) => void;
}

/**
 * Client-only UI state (docs/03 §7.3). Persisted bits: sidebar, density, env.
 * Ephemeral bits (commandOpen) are not persisted.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      density: "comfortable",
      commandOpen: false,
      env: "prod",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDensity: (density) => set({ density }),
      toggleDensity: () => set((s) => ({ density: s.density === "compact" ? "comfortable" : "compact" })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setEnv: (env) => set({ env }),
    }),
    {
      name: "agentik-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, density: s.density, env: s.env }),
    },
  ),
);
