"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/auth/api";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const awaitingEmail = params.get("pending") === "1";
  const [state, setState] = useState<"pending" | "ok" | "error">(token ? "pending" : "error");
  // The verify token is single-use (cleared server-side on first success). Guard against React
  // strict-mode's double-invoke so we POST exactly once — otherwise the 2nd call fails on the
  // already-cleared token and overwrites the success state.
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const r = await authApi.verify(token);
        setState(r.ok ? "ok" : "error");
      } catch {
        setState("error");
      }
    })();
  }, [token]);

  // No token yet, just told to check the inbox.
  if (awaitingEmail && !token) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a verification link to your inbox. Open it to activate your account, then continue.
        </p>
      </div>
    );
  }

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
      {state === "ok" && (
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
