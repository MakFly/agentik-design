import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** back affordance: { href, label } */
  back?: { href: string; label?: string };
  actions?: ReactNode;
  /** rendered below the header row (e.g. a Tabs list or toolbar) */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, back, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 border-b border-border pb-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {back ? (
            <Link
              href={back.href}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              {back.label ?? "Back"}
            </Link>
          ) : null}
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
