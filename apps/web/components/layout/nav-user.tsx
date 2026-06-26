"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, User, Keyboard, Sun, Moon, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { authApi } from "@/lib/auth/api";
import { useUiStore } from "@/lib/stores/ui.store";
import { useSessionStore } from "@/lib/stores/session.store";

/**
 * Account card pinned to the sidebar footer (v3 look). Wires the menu items to
 * the app's real flows: command palette (ui store), theme (next-themes) and the
 * engine logout endpoint (clears the session store, then back to /login).
 */
export function NavUser({ team }: { team: string }) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { setTheme, resolvedTheme } = useTheme();
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const session = useSessionStore((s) => s.session);
  const clearSession = useSessionStore((s) => s.clearSession);

  if (!session) return null;
  const { user } = session;

  async function signOut() {
    try {
      await authApi.logout();
    } finally {
      clearSession();
      router.push("/login");
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarImage src={user.avatarUrl} alt={user.name} />
                <AvatarFallback className="rounded-lg">{user.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="flex items-center gap-3 p-2">
              <Avatar className="size-10 rounded-lg">
                <AvatarImage src={user.avatarUrl} alt={user.name} />
                <AvatarFallback className="rounded-lg">{user.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <span className="block truncate font-medium text-foreground">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => router.push(`/${team}/settings?tab=profile`)}
              >
                <User className="size-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCommandOpen(true)}>
                <Keyboard className="size-4" /> Command palette
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setTheme(resolvedTheme === "dark" ? "light" : "dark");
                }}
              >
                {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                Toggle theme
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
