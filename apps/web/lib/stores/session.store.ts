import { create } from "zustand";
import type { Session } from "@/types/domain";

/**
 * Holds the resolved session for the active team, hydrated by the [team] layout
 * from the real engine (`/api/v1/auth/me`). There is no mock fallback: until the
 * engine answers, `session` is null and `hydrated` is false. The SessionGuard
 * renders a loader while unhydrated and redirects to /login when there is no
 * session. Engine RBAC remains the source of truth regardless.
 */
interface SessionState {
  session: Session | null;
  hydrated: boolean;
  setSession: (s: Session) => void;
  /** mark hydration complete with no authenticated session (→ guard redirects to /login) */
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  hydrated: false,
  setSession: (session) => set({ session, hydrated: true }),
  clearSession: () => set({ session: null, hydrated: true }),
}));
