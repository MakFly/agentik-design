"use client";

import { useEffect, useState } from "react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";

/**
 * Shiki-backed code highlighter for assistant-ui fenced code blocks. The full shiki
 * bundle is dynamically imported on the first code block (kept out of the initial
 * bundle), then grammars load on demand. Dual themes are emitted as CSS variables
 * (`defaultColor: false`) so light/dark switches with the `.dark` class — no
 * re-highlight on theme toggle (see `.aui-shiki` rules in globals.css).
 */
let shikiMod: Promise<typeof import("shiki")> | null = null;
const loadShiki = () => (shikiMod ??= import("shiki"));

export function ShikiHighlighter({ code, language }: SyntaxHighlighterProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadShiki()
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang: language || "text",
          themes: { light: "github-light", dark: "github-dark-default" },
          defaultColor: false,
        }),
      )
      // Keep the previous render until the new one is ready (no flicker while streaming);
      // unknown languages throw → fall back to plain text.
      .then((out) => active && setHtml(out))
      .catch(() => active && setHtml(null));
    return () => {
      active = false;
    };
  }, [code, language]);

  // Joins the CodeHeader above it (rounded-bottom only). While shiki loads / for unknown
  // languages, show plain text in a matching shell.
  const shell = "aui-shiki mb-3 overflow-x-auto rounded-b-md border border-t-0 border-border text-sm";
  if (!html) {
    return (
      <div className={`${shell} bg-surface-2 p-3`}>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return <div className={shell} dangerouslySetInnerHTML={{ __html: html }} />;
}
