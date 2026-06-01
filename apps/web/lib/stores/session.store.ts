import { create } from "zustand";
import type { Session, TeamId, UserId } from "@/types/domain";

/**
 * Holds the resolved session for the active team. Hydrated by the [team] layout
 * from `/session/me` (MSW for now). A sensible mock keeps the UI rendering before
 * the query resolves; switch the role here to exercise RBAC during development.
 */
const MOCK_SESSION: Session = {
  user: {
    id: "usr_alice" as UserId,
    name: "Alice Martin",
    email: "alice@acme.dev",
  },
  team: { id: "team_acme" as TeamId, slug: "acme", name: "Acme" },
  role: "owner",
  permissions: "*",
  teams: [
    { id: "team_acme" as TeamId, slug: "acme", name: "Acme" },
    { id: "team_labs" as TeamId, slug: "labs", name: "Acme Labs" },
  ],
};

interface SessionState {
  session: Session;
  hydrated: boolean;
  setSession: (s: Session) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: MOCK_SESSION,
  hydrated: false,
  setSession: (session) => set({ session, hydrated: true }),
}));
