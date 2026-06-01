import { Wifi, WifiOff, Loader2, RefreshCw } from "lucide-react";
import type { ConnectionState } from "@/lib/realtime/event-reducer";
import { cn } from "@/lib/utils";

const META: Record<ConnectionState, { label: string; cls: string; spin?: boolean; Icon: typeof Wifi }> = {
  idle: { label: "Idle", cls: "text-muted-foreground", Icon: WifiOff },
  connecting: { label: "Connecting…", cls: "text-info", spin: true, Icon: Loader2 },
  open: { label: "Live", cls: "text-success", Icon: Wifi },
  reconnecting: { label: "Reconnecting…", cls: "text-warning", spin: true, Icon: RefreshCw },
  closed: { label: "Ended", cls: "text-muted-foreground", Icon: WifiOff },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const m = META[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", m.cls)} role="status" aria-live="polite">
      <m.Icon className={cn("size-3.5", m.spin && "animate-spin")} aria-hidden="true" />
      {m.label}
    </span>
  );
}
