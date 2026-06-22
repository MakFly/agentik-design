"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/auth/api";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!token) {
        if (!cancelled) setState("error");
        return;
      }
      try {
        const r = await authApi.verify(token);
        if (!cancelled) setState(r.ok ? "ok" : "error");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {state === "pending" ? "Verifying…" : state === "ok" ? "Email verified" : "Verification failed"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {state === "ok"
          ? "Your email is confirmed. You're all set."
          : state === "error"
            ? "This link is invalid or expired."
            : "One moment."}
      </p>
      {state !== "pending" && (
        <Button asChild className="mt-6 min-h-11">
          <Link href="/onboarding">Continue</Link>
        </Button>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading…</p>}>
      <VerifyInner />
    </Suspense>
  );
}
