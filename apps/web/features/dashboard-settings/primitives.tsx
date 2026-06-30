import type { ReactNode } from "react";

/**
 * Linear-style settings primitives: a large page heading, named groups, and
 * rows laid out as label + description on the left and a control on the right.
 * Shared by every settings section so the surface stays visually consistent.
 */

export function SettingsHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-8 flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </header>
  );
}

export function SettingsGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The bordered, divided container holding a group's rows. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-border bg-card divide-y overflow-hidden rounded-xl border">
      {children}
    </ul>
  );
}

export function SettingsRow({
  label,
  description,
  control,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {control ? <div className="shrink-0">{control}</div> : null}
    </li>
  );
}
