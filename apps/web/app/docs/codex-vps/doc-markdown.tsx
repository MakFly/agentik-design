"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Router-aware back: the docs route lives outside the team-scoped shell, so going
 * back must stay under Next's router (not raw `window.history.back()`) to keep the
 * client navigation soft. A hard pop tears down the in-memory session store and
 * leaves the team shell stuck on "Loading your workspace…" until a manual refresh.
 */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Back
    </button>
  );
}

/** Tailwind-styled markdown for the docs page (no `prose` plugin dependency). */
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-2 text-balance text-[clamp(1.6rem,1.2rem+2vw,2.25rem)] font-semibold tracking-tight">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 border-b border-border pb-2 text-[clamp(1.2rem,1rem+1vw,1.5rem)] font-semibold">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-base font-semibold">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-4 leading-relaxed text-foreground/90">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mt-4 list-disc space-y-1.5 pl-6 text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-4 list-decimal space-y-1.5 pl-6 text-foreground/90">
      {children}
    </ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 rounded-r-lg border-l-4 border-warning/60 bg-warning/5 px-4 py-2 text-sm text-foreground/90">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = (className ?? "").includes("language-");
    if (isBlock) {
      return (
        <code className="font-mono text-[13px] leading-relaxed">{children}</code>
      );
    }
    return (
      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface-2 p-4">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border bg-surface-2 px-3 py-2 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-2 align-top">{children}</td>
  ),
  hr: () => <hr className="my-8 border-border" />,
};

export function DocMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
