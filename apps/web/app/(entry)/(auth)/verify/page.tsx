"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/auth/api";
import { postAuthDestination } from "@/lib/auth/post-auth";

const PENDING_EMAIL_KEY = "pendingEmail";
const PENDING_CODE_KEY = "pendingVerifyCode";

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const awaitingEmail = params.get("pending") === "1";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "pending" | "ok" | "error">(token ? "pending" : "form");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(PENDING_EMAIL_KEY);
    if (stored) setEmail(stored);
    const storedCode = sessionStorage.getItem(PENDING_CODE_KEY);
    if (storedCode) setDevCode(storedCode);
  }, []);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const r = await authApi.verify(token);
        if (r.ok) {
          sessionStorage.removeItem(PENDING_EMAIL_KEY);
          sessionStorage.removeItem(PENDING_CODE_KEY);
          const me = await authApi.me();
          router.replace(me ? postAuthDestination(me) : "/login");
        } else {
          setState("error");
        }
      } catch {
        setState("error");
      }
    })();
  }, [token, router]);

  async function onSubmitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email || code.length !== 6) return;
    setError(null);
    setBusy(true);
    try {
      const r = await authApi.verifyCode(email, code);
      if (r.ok) {
        sessionStorage.removeItem(PENDING_EMAIL_KEY);
        sessionStorage.removeItem(PENDING_CODE_KEY);
        const me = await authApi.me();
        router.push(me ? postAuthDestination(me) : "/login");
      } else {
        setError("Invalid code. Try again.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg === "code_expired"
          ? "Code expired — sign up again."
          : msg === "invalid_code"
            ? "Invalid code. Try again."
            : "Verification failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (token && state === "pending") {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Verifying…</h1>
        <p className="mt-2 text-sm text-muted-foreground">One moment.</p>
      </div>
    );
  }

  if (token && state === "error") {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Verification failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">This link is invalid or expired.</p>
        <Button asChild className="mt-6 min-h-11">
          <Link href="/signup">Back to sign up</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {awaitingEmail ? "Check your email" : "Verify your email"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter the 6-digit code we sent to your inbox.
      </p>
      {devCode && (
        <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-center font-mono text-sm">
          Dev code: <strong>{devCode}</strong>
        </p>
      )}
      <form onSubmit={onSubmitOtp} className="mt-6 flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="verify-email">Email</Label>
          <Input
            id="verify-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="verify-code">Verification code</Label>
          <Input
            id="verify-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            placeholder="000000"
            className="font-mono text-center text-lg tracking-[0.35em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger,oklch(0.6_0.2_25))]">
            {error}
          </p>
        )}
        <Button type="submit" className="min-h-11" disabled={busy || code.length !== 6}>
          {busy ? "Verifying…" : "Continue"}
        </Button>
      </form>
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
