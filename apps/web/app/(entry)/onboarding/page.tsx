"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import {
  EMPTY_QUESTIONNAIRE,
  type QuestionnaireAnswers,
} from "@/components/onboarding/types";
import { authApi } from "@/lib/auth/api";
import { activeOrg } from "@/lib/auth/post-auth";

function mergeQuestionnaire(raw: Record<string, unknown> | undefined): QuestionnaireAnswers {
  if (!raw || typeof raw !== "object") return EMPTY_QUESTIONNAIRE;
  return {
    ...EMPTY_QUESTIONNAIRE,
    source: Array.isArray(raw.source) ? (raw.source as string[]) : [],
    source_other: typeof raw.source_other === "string" ? raw.source_other : null,
    role: typeof raw.role === "string" ? raw.role : null,
    role_other: typeof raw.role_other === "string" ? raw.role_other : null,
    use_case: Array.isArray(raw.use_case) ? (raw.use_case as string[]) : [],
    use_case_other: typeof raw.use_case_other === "string" ? raw.use_case_other : null,
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const [org, setOrg] = useState<{ name: string; slug: string; teamId: string } | null>(null);
  const [initialAnswers, setInitialAnswers] = useState<QuestionnaireAnswers>(EMPTY_QUESTIONNAIRE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const me = await authApi.me();
      if (cancelled) return;
      if (!me) {
        router.replace("/login");
        return;
      }
      if (!me.user.emailVerifiedAt) {
        router.replace("/verify?pending=1");
        return;
      }
      const active = activeOrg(me);
      if (!active) {
        router.replace("/verify?pending=1");
        return;
      }
      if (active.onboardingCompleted) {
        router.replace(`/${active.slug}/projects`);
        return;
      }
      setOrg({ name: active.name, slug: active.slug, teamId: active.teamId });
      setInitialAnswers(mergeQuestionnaire(me.user.onboardingQuestionnaire));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading || !org) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-[var(--mul-muted,#6e6e73)]">
        Loading…
      </div>
    );
  }

  return (
    <OnboardingFlow
      org={org}
      initialAnswers={initialAnswers}
      onComplete={() => router.push(`/${org.slug}/projects`)}
    />
  );
}
