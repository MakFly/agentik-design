"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Team root → the personal assistant is the primary surface. Client redirect (the parent
 * SessionGuard gates rendering on a hydrated session, so a server redirect here never runs).
 * The two surfaces are symmetric: /{team}/assistant/* and /{team}/platform/*.
 */
export default function TeamRootPage() {
  const params = useParams<{ team: string }>();
  const router = useRouter();
  useEffect(() => {
    if (params?.team) router.replace(`/${params.team}/assistant/chat`);
  }, [params?.team, router]);
  return null;
}
