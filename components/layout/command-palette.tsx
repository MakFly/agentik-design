"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowRight } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { NAV_ITEMS, hrefFor } from "@/config/nav";
import { useUiStore } from "@/lib/stores/ui.store";
import { useRbac } from "@/lib/auth/rbac";

export function CommandPalette({ team }: { team: string }) {
  const router = useRouter();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const { can } = useRbac();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const navItems = NAV_ITEMS.filter((i) => !i.permission || can(i.permission));

  const quickActions = [
    { key: "new-agent", label: "Create agent", href: hrefFor(team, "agents/new"), permission: "agent:create" as const },
    { key: "new-workflow", label: "Create workflow", href: hrefFor(team, "workflows/new"), permission: "workflow:create" as const },
  ].filter((a) => can(a.permission));

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Navigate and run commands">
      <CommandInput placeholder="Search or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {quickActions.length ? (
          <>
            <CommandGroup heading="Actions">
              {quickActions.map((a) => (
                <CommandItem key={a.key} value={`action ${a.label}`} onSelect={() => go(a.href)}>
                  <Plus className="size-4" />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}

        <CommandGroup heading="Go to">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.key}
                value={`goto ${item.label}`}
                onSelect={() => go(hrefFor(team, item.segment))}
              >
                <Icon className="size-4" />
                <span className="flex-1">{item.label}</span>
                <ArrowRight className="size-3.5 text-subtle-foreground" />
                <CommandShortcut>g {item.hotkey}</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
