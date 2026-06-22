"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/auth/api";

/**
 * DEV-ONLY quick login. Lists seeded demo accounts (the engine returns them only when
 * AUTH_DEV_HEADERS is on) and logs in with one click. Renders nothing in production.
 */
export function DevLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["dev-users"],
    queryFn: () => authApi.devUsers(),
    staleTime: Infinity,
    retry: false,
  });
  const users = data ?? [];
  if (users.length === 0) return null;

  async function quickLogin(email: string, password: string) {
    setBusy(email);
    try {
      await authApi.login({ email, password });
      const me = await authApi.me();
      router.push(me?.orgs[0]?.slug ? `/${me.orgs[0].slug}/runs` : "/onboarding");
    } catch {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs font-medium text-subtle-foreground">Dev quick login</p>
      <div className="mt-2 flex flex-col gap-2">
        {users.map((u) => (
          <button
            key={u.email}
            type="button"
            disabled={busy !== null}
            onClick={() => quickLogin(u.email, u.password)}
            className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 text-left text-sm transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            <span className="min-w-0 truncate">{u.email}</span>
            <span className="shrink-0 text-xs text-subtle-foreground">{busy === u.email ? "Signing in…" : u.role}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
