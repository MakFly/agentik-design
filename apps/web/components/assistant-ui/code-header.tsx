"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import type { CodeHeaderProps } from "@assistant-ui/react-markdown";

/**
 * Header bar above a fenced code block: language label + copy button. Renders nothing for
 * language-less blocks (those fall back to the plain `<pre>` styling). Pairs visually with
 * `ShikiHighlighter` — this is rounded-top, the code block rounded-bottom.
 */
export function CodeBlockHeader({ language, code }: CodeHeaderProps) {
  const [copied, setCopied] = useState(false);
  if (!language) return null;

  const onCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copié");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible");
    }
  };

  return (
    <div className="mt-3 flex items-center justify-between rounded-t-md border border-b-0 border-border bg-surface-2 px-3 py-1.5">
      <span className="font-mono text-xs lowercase text-muted-foreground">{language}</span>
      <button
        type="button"
        onClick={onCopy}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Copier le code"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
}
