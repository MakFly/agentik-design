"use client";

import { Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CommandBlock({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground">
          <Terminal className="size-3.5 text-muted-foreground" />
          {label}
        </div>
        <code className="block overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface px-2.5 py-2 font-mono text-xs">
          {command}
        </code>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          navigator.clipboard?.writeText(command);
          toast.success("Command copied");
        }}
      >
        <Copy className="size-4" />
        Copy
      </Button>
    </div>
  );
}
