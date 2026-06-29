"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/auth/api";
import { postAuthDestination } from "@/lib/auth/post-auth";

/** Root resolver: send signed-in users into their workspace, everyone else to login. */
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      try {
        const me = await authApi.me();
        router.replace(me ? postAuthDestination(me) : "/login");
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  return (
    <div
      className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
  );
}
