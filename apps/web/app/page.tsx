import { redirect } from "next/navigation";

import { useSessionStore } from "@/lib/stores/session.store";

export default function HomePage() {
  // No real auth yet: the store is seeded with the mock team (slug "acme").
  // Reading the session here keeps the entry redirect in sync with whoever is
  // "logged in" — swap the store's hydration source for real auth (cookie /
  // header lookup) and this redirect follows along without touching this file.
  const { slug } = useSessionStore.getState().session.team;
  // Land on the (app) shell (sidebar + nav), not the bare (canvas)/dashboard
  // full-screen demo. `runs` is the default entry surface of the system.
  redirect(`/${slug}/runs`);
}
