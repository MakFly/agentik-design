import { create } from "zustand";
import { persist } from "zustand/middleware";

/** How the composer submits a message. Maps to assistant-ui's `submitMode`. */
export type SubmitMode = "enter" | "ctrlEnter";
export type ThemePreference = "light" | "dark" | "system";

/**
 * User-facing assistant preferences, edited from settings and chat settings.
 * Persisted to localStorage and synced to the engine when saved from settings.
 */
interface PreferencesState {
  reduceMotion: boolean;
  submitMode: SubmitMode;
  theme: ThemePreference;
  setReduceMotion: (v: boolean) => void;
  setSubmitMode: (m: SubmitMode) => void;
  setTheme: (t: ThemePreference) => void;
  /** Hydrate from server `/auth/me` without clobbering unsaved local edits unnecessarily. */
  hydrateFromServer: (prefs: Partial<Pick<PreferencesState, "reduceMotion" | "submitMode" | "theme">>) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      reduceMotion: false,
      submitMode: "enter",
      theme: "system",
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setSubmitMode: (submitMode) => set({ submitMode }),
      setTheme: (theme) => set({ theme }),
      hydrateFromServer: (prefs) => {
        const next: Partial<PreferencesState> = {};
        if (prefs.reduceMotion !== undefined) next.reduceMotion = prefs.reduceMotion;
        if (prefs.submitMode !== undefined) next.submitMode = prefs.submitMode;
        if (prefs.theme !== undefined) next.theme = prefs.theme;
        if (Object.keys(next).length) set(next);
      },
    }),
    { name: "agentik-preferences" },
  ),
);
