import {
  CheckCircle2,
  XCircle,
  Loader2,
  PauseCircle,
  Clock,
  CircleSlash,
  Circle,
  AlertTriangle,
  ShieldQuestion,
  Plug,
  PlugZap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "danger" | "warning" | "info" | "running" | "neutral";

interface StatusMeta {
  label: string;
  tone: Tone;
  Icon: LucideIcon;
  spin?: boolean;
}

/** Single source of truth for status presentation across run/agent/tool/step (docs/02 §5.5). */
const STATUS_META: Record<string, StatusMeta> = {
  // run
  queued: { label: "Queued", tone: "neutral", Icon: Clock },
  running: { label: "Running", tone: "running", Icon: Loader2, spin: true },
  paused: { label: "Paused", tone: "warning", Icon: PauseCircle },
  waiting_approval: { label: "Awaiting approval", tone: "info", Icon: ShieldQuestion },
  succeeded: { label: "Succeeded", tone: "success", Icon: CheckCircle2 },
  failed: { label: "Failed", tone: "danger", Icon: XCircle },
  cancelled: { label: "Cancelled", tone: "neutral", Icon: CircleSlash },
  timed_out: { label: "Timed out", tone: "danger", Icon: Clock },
  // agent health
  healthy: { label: "Healthy", tone: "success", Icon: CheckCircle2 },
  degraded: { label: "Degraded", tone: "warning", Icon: AlertTriangle },
  error: { label: "Error", tone: "danger", Icon: XCircle },
  idle: { label: "Idle", tone: "neutral", Icon: Circle },
  disabled: { label: "Disabled", tone: "neutral", Icon: CircleSlash },
  // tool
  connected: { label: "Connected", tone: "success", Icon: Plug },
  disconnected: { label: "Disconnected", tone: "neutral", Icon: CircleSlash },
  auth_expired: { label: "Auth expired", tone: "warning", Icon: AlertTriangle },
  testing: { label: "Testing", tone: "running", Icon: PlugZap, spin: true },
  // step
  pending: { label: "Pending", tone: "neutral", Icon: Circle },
  skipped: { label: "Skipped", tone: "neutral", Icon: CircleSlash },
  retrying: { label: "Retrying", tone: "warning", Icon: Loader2, spin: true },
};

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  running: "bg-running/10 text-running",
  neutral: "bg-surface-2 text-muted-foreground",
};

export interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  /** show only the icon dot (still labelled for screen readers) */
  iconOnly?: boolean;
  className?: string;
}

export function StatusBadge({ status, size = "md", iconOnly = false, className }: StatusBadgeProps) {
  const meta = STATUS_META[status] ?? { label: status, tone: "neutral" as Tone, Icon: Circle };
  const { Icon } = meta;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        TONE_CLASS[meta.tone],
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs",
        iconOnly && "px-1 py-1",
        className,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", meta.spin && "animate-spin")} aria-hidden="true" />
      {iconOnly ? <span className="sr-only">{meta.label}</span> : <span>{meta.label}</span>}
    </span>
  );
}
