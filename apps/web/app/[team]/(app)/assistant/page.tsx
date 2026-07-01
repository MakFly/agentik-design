"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Bare /{team}/assistant → the chat is the assistant's entry point (client redirect; see
 * the team-root page for why a server redirect can't run behind SessionGuard). */
export default function AssistantRootPage() {
  const params = useParams<{ team: string }>();
  const router = useRouter();
  useEffect(() => {
    if (params?.team) router.replace(`/${params.team}/assistant/chat`);
  }, [params?.team, router]);
  return null;
}
