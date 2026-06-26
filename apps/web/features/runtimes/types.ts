export interface DetectedTool {
  name: string;
  path?: string;
  version?: string;
  available: boolean;
  authenticated?: boolean;
  authSource?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateChecked?: boolean;
}

export interface DaemonInfo {
  id: string;
  name: string;
  status: string;
  mode?: "personal" | "org" | "legacy";
  lastHeartbeatAt: string | null;
  meta: {
    host?: { host?: string; os?: string; arch?: string; go?: string };
    deviceId?: string;
    deviceName?: string;
    runtimes?: string[];
    tools?: DetectedTool[];
    installable?: string[];
  };
}

export interface SystemInfo {
  daemonEnabled: boolean;
  providers: {
    anthropic: boolean;
    openai: boolean;
    openrouter: boolean;
    google: boolean;
  };
  daemons: DaemonInfo[];
  runtimes: Array<{
    id: string;
    daemonId: string;
    kind: string;
    status: string;
  }>;
  availableRuntimes: string[];
}

export interface LocalDaemonStatus {
  ok: boolean;
  orchestratorAvailable?: boolean;
  installed: boolean;
  running: boolean;
  status: string;
  command?: string;
  configPath?: string;
  health?: {
    running: boolean;
    daemonId?: string;
    deviceName?: string;
    engineUrl?: string;
    pid?: number;
    runtimes?: string[];
  };
}

export interface InstallEvent {
  phase:
    | "started"
    | "log"
    | "status"
    | "daemon.running"
    | "completed"
    | "failed";
  message: string;
  at: string;
  running?: boolean;
  terminal?: boolean;
}

export type LocalDaemonCapability = "checking" | "local_available" | "hosted";
