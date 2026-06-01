import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface KeyValueItem {
  label: string;
  value: ReactNode;
}

/** Dense metadata display used in drawers and detail panels (docs/02 §5.2). */
export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm", className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="truncate text-muted-foreground">{item.label}</dt>
          <dd className="truncate text-right font-medium text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
