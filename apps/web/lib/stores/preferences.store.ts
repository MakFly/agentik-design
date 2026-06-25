import { create } from "zustand";
import { persist } from "zustand/middleware";

/** How the composer submits a message. Maps to assistant-ui's `submitMode`. */
export type SubmitMode = "enter" | "ctrlEnter";

/**
 * User-facing assistant preferences, edited from /{team}/chat/settings and
 * read live by the chat (composer submit mode) and the app shell (reduce motion).
 * Persisted to localStorage; same-tab updates are reactive via the store.
 */
interface PreferencesState {
  reduceMotion: boolean;
  submitMode: SubmitMode;
  setReduceMotion: (v: boolean) => void;
  setSubmitMode: (m: SubmitMode) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      reduceMotion: false,
      submitMode: "enter",
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setSubmitMode: (submitMode) => set({ submitMode }),
    }),
    { name: "agentik-preferences" },
  ),
);
