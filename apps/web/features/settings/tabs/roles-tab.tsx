"use client";

import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RESOURCES, ACTIONS, ROLES, ROLE_PERMISSIONS, type Role, type Resource, type Action } from "@/config/permissions";
import { useMembers } from "../api";
import { cn } from "@/lib/utils";

const ACTION_CODE: Record<Action, string> = {
  read: "R",
  create: "C",
  update: "U",
  delete: "D",
  run: "run",
  approve: "appr",
  control: "ctrl",
};

/** Compact CRUD-style cell summary for a role × resource pair. */
function summarize(role: Role, resource: Resource): string {
  const perms = ROLE_PERMISSIONS[role];
  if (perms === "*") return "CRUD";
  const held = ACTIONS.filter((a) => perms.includes(`${resource}:${a}`));
  if (held.length === 0) return "—";
  const crud = (["create", "read", "update", "delete"] as Action[]).every((a) => held.includes(a));
  if (crud) {
    const extra = held.filter((a) => !["create", "read", "update", "delete"].includes(a));
    return extra.length ? `CRUD+${extra.map((a) => ACTION_CODE[a]).join("+")}` : "CRUD";
  }
  return held.map((a) => ACTION_CODE[a]).join("+");
}

export function RolesTab({ team }: { team: string }) {
  const { data } = useMembers(team);
  const counts = new Map<Role, number>();
  for (const m of data?.items ?? []) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-prose">
          Permissions are <span className="font-medium text-foreground">resource × action</span> with least-privilege defaults. The frontend gates the UX; the backend enforces the truth.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left">
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 text-right font-medium tabular-nums">Members</th>
              {RESOURCES.map((r) => (
                <th key={r} className="px-3 py-2 font-medium capitalize">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role} className="border-b border-border last:border-0 hover:bg-surface-2/40">
                <td className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium capitalize">{role}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground" data-tabular>
                  {counts.get(role) ?? 0}
                </td>
                {RESOURCES.map((res) => {
                  const v = summarize(role, res);
                  return (
                    <td key={res} className="px-3 py-2">
                      <span
                        className={cn(
                          "font-mono text-xs",
                          v === "—" ? "text-muted-foreground/50" : v.startsWith("CRUD") ? "text-success" : "text-foreground",
                        )}
                      >
                        {v}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Legend</span>
        {(Object.entries(ACTION_CODE) as [Action, string][]).map(([action, code]) => (
          <span key={action} className="flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px]">
              {code}
            </Badge>
            <span className="capitalize">{action}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
