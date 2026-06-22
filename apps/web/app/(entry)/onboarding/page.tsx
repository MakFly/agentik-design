"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, slugify } from "@/lib/auth/api";

type Created = { teamId: string; slug: string; daemonToken: string };

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authApi.createOrg({ name, slug: slug || slugify(name) });
      setCreated(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "email_unverified") {
        router.push("/verify?pending=1");
        return;
      }
      setError(msg === "slug_taken" ? "That slug is taken — try another." : "Could not create the organization.");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const cmd = `agentik-daemon --engine http://localhost:8787 --token ${created.daemonToken}`;
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;re set up</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a daemon to run agents on your own infra. Run this where your runtime lives:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed">
          <code>{cmd}</code>
        </pre>
        <p className="mt-2 text-xs text-subtle-foreground">
          This org-scoped token authenticates the daemon. Keep it secret — you can rotate it later in Settings.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button className="min-h-11" onClick={() => router.push(`/${created.slug}/agents/new`)}>
            Create your first agent
          </Button>
          <Button variant="outline" className="min-h-11" onClick={() => router.push(`/${created.slug}/runs`)}>
            Skip to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your organization</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your team&apos;s workspace. You&apos;ll be the owner.</p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="org-slug">URL slug</Label>
          <Input
            id="org-slug"
            required
            pattern="[a-z0-9\-]+"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
          <p className="text-xs text-subtle-foreground">agentik.app/{slug || "your-org"}</p>
        </div>
        {error && <p role="alert" className="text-sm text-[var(--danger,oklch(0.6_0.2_25))]">{error}</p>}
        <Button type="submit" className="min-h-11" disabled={busy}>
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </div>
  );
}
