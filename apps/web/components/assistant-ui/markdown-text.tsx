"use client";

import {
  MarkdownTextPrimitive,
} from "@assistant-ui/react-markdown";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const markdownComponents = {
  p: ({ className, ...props }) => (
    <p className={cx("mb-2.5 last:mb-0", className)} {...props} />
  ),
  h1: ({ className, ...props }) => (
    <h1
      className={cx("mt-4 mb-2 text-xl leading-tight font-semibold first:mt-0", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cx("mt-4 mb-2 text-lg leading-tight font-semibold first:mt-0", className)}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cx("mt-3.5 mb-1.5 text-base leading-snug font-semibold first:mt-0", className)}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cx("mt-3.5 mb-1.5 text-base leading-snug font-semibold first:mt-0", className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cx("my-2 list-disc space-y-1 pl-5", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cx("my-2 list-decimal space-y-1 pl-5", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cx("pl-1 [&>p]:mb-1", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cx("text-muted-foreground my-3 border-l border-border pl-3.5", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cx("my-3 border-0 border-t border-border", className)} {...props} />
  ),
  code: ({ className, ...props }) => (
    <code
      className={cx("rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cx("my-3 overflow-x-auto rounded-md bg-surface-2 p-3 text-sm", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <table className={cx("my-3 w-full border-collapse text-sm", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cx("border border-border bg-muted px-2 py-1.5 text-left font-semibold", className)}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td className={cx("border border-border px-2 py-1.5 text-left", className)} {...props} />
  ),
} satisfies NonNullable<Options["components"]>;

export function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      className="aui-md max-w-[70ch] text-base leading-[1.625] text-foreground"
    />
  );
}

export function MarkdownBlock({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cx("aui-md max-w-[70ch] text-base leading-[1.625] text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
