"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronsUpDown,
  Loader2,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "./theme-toggle";
import {
  useEnvironmentSettings,
  useUpdateEnvironmentSettings,
} from "@/features/configure/settings-api";
import { useUiStore } from "@/lib/stores/ui.store";
import type { EnvironmentColor, ManagedEnvironment } from "@/types/domain";
import { cn } from "@/lib/utils";

const COLORS: EnvironmentColor[] = [
  "success",
  "info",
  "warning",
  "danger",
  "muted",
];
const colorDot: Record<EnvironmentColor, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted-foreground",
};
const ENV_ID_RE = /^[a-z0-9_-]+$/;

/**
 * Slim header inside the SidebarInset. The org switcher and account card now
 * live in the sidebar (TeamSwitcher / NavUser); this bar keeps the cross-cutting
 * actions: sidebar toggle, centered ⌘K search, env selector, and theme toggle.
 */
export function Topbar({ team }: { team: string }) {
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);

  return (
    <header className="sticky top-0 z-10 flex h-[var(--navbar-h)] shrink-0 items-center gap-2 bg-background px-4">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />

      {/* command palette trigger — absolutely centered in the header */}
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="absolute top-1/2 left-1/2 hidden h-9 w-full max-w-md -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md bg-surface-2 px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-3 md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search or run a command…</span>
        <kbd className="rounded border border-border bg-surface px-1.5 text-[11px] font-medium">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Search"
          onClick={() => setCommandOpen(true)}
        >
          <Search className="size-4" />
        </Button>

        <EnvironmentSelector team={team} />

        <ThemeToggle />
      </div>
    </header>
  );
}

function EnvironmentSelector({ team }: { team: string }) {
  const env = useUiStore((s) => s.env);
  const setEnv = useUiStore((s) => s.setEnv);
  const { data, isLoading } = useEnvironmentSettings(team);
  const update = useUpdateEnvironmentSettings(team);
  const [manageOpen, setManageOpen] = useState(false);
  const [draft, setDraft] = useState<ManagedEnvironment[]>([]);
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const active =
    items.find((item) => item.id === env) ??
    items.find((item) => item.id === data?.activeId) ??
    items[0];
  const normalizedDraft = draft.map((item) => ({
    ...item,
    id: item.id.trim().toLowerCase(),
    label: item.label.trim(),
  }));
  const draftIds = new Set(normalizedDraft.map((item) => item.id));
  const draftValid =
    normalizedDraft.length > 0 &&
    normalizedDraft.every(
      (item) => ENV_ID_RE.test(item.id) && item.label.length > 0,
    ) &&
    draftIds.size === normalizedDraft.length;

  useEffect(() => {
    if (!data) return;
    if (!items.some((item) => item.id === env)) setEnv(data.activeId);
  }, [data, env, items, setEnv]);

  const selectEnvironment = (value: string) => {
    setEnv(value);
    if (items.length > 0) {
      update.mutate({ items, activeId: value });
    }
  };

  const addEnvironment = () => {
    const n = draft.length + 1;
    setDraft([
      ...draft,
      { id: `env-${n}`, label: `Environment ${n}`, color: "muted" },
    ]);
  };

  const patchDraft = (index: number, patch: Partial<ManagedEnvironment>) => {
    setDraft(
      draft.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const removeDraft = (index: number) => {
    if (draft.length <= 1) return;
    setDraft(draft.filter((_, i) => i !== index));
  };

  const openManage = () => {
    setDraft(items);
    setManageOpen(true);
  };

  const saveDraft = async () => {
    if (!draftValid) return;
    const activeId = normalizedDraft.some((item) => item.id === env)
      ? env
      : normalizedDraft[0]!.id;
    const saved = await update.mutateAsync({
      items: normalizedDraft,
      activeId,
    });
    setEnv(saved.activeId);
    setManageOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <span
                className={cn(
                  "size-2 rounded-full",
                  colorDot[active?.color ?? "muted"],
                )}
                aria-hidden="true"
              />
            )}
            <span>{active?.label ?? "Environment"}</span>
            <ChevronsUpDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>
            Environment
            {data?.source === "node_env" ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                from NODE_ENV
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={active?.id ?? env}
            onValueChange={selectEnvironment}
          >
            {items.map((item) => (
              <DropdownMenuRadioItem key={item.id} value={item.id}>
                <span
                  className={cn("size-2 rounded-full", colorDot[item.color])}
                />
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={openManage}>
            <Settings2 className="size-4" />
            Manage environments
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage environments</DialogTitle>
            <DialogDescription>
              These environments are stored in workspace settings and drive the
              header selector.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {draft.map((item, index) => (
              <div
                key={index}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_140px_32px] items-end gap-2"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor={`env-id-${index}`}>ID</Label>
                  <Input
                    id={`env-id-${index}`}
                    value={item.id}
                    onChange={(event) =>
                      patchDraft(index, { id: event.target.value })
                    }
                    placeholder="prod"
                    aria-invalid={
                      !ENV_ID_RE.test(item.id.trim().toLowerCase()) ||
                      normalizedDraft.filter(
                        (envItem) =>
                          envItem.id === item.id.trim().toLowerCase(),
                      ).length > 1
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`env-label-${index}`}>Label</Label>
                  <Input
                    id={`env-label-${index}`}
                    value={item.label}
                    onChange={(event) =>
                      patchDraft(index, { label: event.target.value })
                    }
                    placeholder="Production"
                    aria-invalid={!item.label.trim()}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Color</Label>
                  <Select
                    value={item.color}
                    onValueChange={(color) =>
                      patchDraft(index, { color: color as EnvironmentColor })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLORS.map((color) => (
                        <SelectItem key={color} value={color}>
                          {color}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  disabled={draft.length <= 1}
                  onClick={() => removeDraft(index)}
                  aria-label={`Delete ${item.label || item.id}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={addEnvironment}
            >
              <Plus className="size-4" /> Add environment
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveDraft}
              disabled={update.isPending || !draftValid}
            >
              {update.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Save environments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
