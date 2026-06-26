"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatShortId } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CopyableValue({
  value,
  className,
  mono = true,
}: {
  value: string;
  className?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-0.5", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              mono && "font-mono text-xs",
            )}
          >
            {formatShortId(value)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm font-mono text-xs break-all">
          {value}
        </TooltipContent>
      </Tooltip>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground"
        onClick={() => void copy()}
        aria-label="Copy value"
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </span>
  );
}
