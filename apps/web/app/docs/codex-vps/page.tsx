import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BackButton, DocMarkdown } from "./doc-markdown";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Connect Codex & deploy on a VPS",
  description:
    "How to authenticate the Codex runtime, connect a ChatGPT subscription, and deploy on a VPS.",
};

export default async function CodexVpsDocPage() {
  const content = await readFile(
    join(process.cwd(), "content/docs/codex-vps.md"),
    "utf8",
  );

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-[80ch] px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-8 sm:px-6">
        <BackButton />
        <article className="mt-4">
          <DocMarkdown content={content} />
        </article>
      </div>
    </main>
  );
}
