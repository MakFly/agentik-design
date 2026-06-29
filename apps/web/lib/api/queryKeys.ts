/**
 * Hierarchical, team-scoped query-key factory (docs/03 §7.3).
 * Invalidate by prefix: queryClient.invalidateQueries({ queryKey: qk.agents.all(team) }).
 */

export type Filters = object | undefined;

export const qk = {
  agents: {
    all: (team: string) => ["team", team, "agents"] as const,
    list: (team: string, filters?: Filters) =>
      ["team", team, "agents", "list", filters ?? {}] as const,
    detail: (team: string, id: string) =>
      ["team", team, "agents", "detail", id] as const,
    versions: (team: string, id: string) =>
      ["team", team, "agents", id, "versions"] as const,
    snapshot: (team: string) => ["team", team, "agents", "snapshot"] as const,
  },
  workflows: {
    all: (team: string) => ["team", team, "workflows"] as const,
    list: (team: string, filters?: Filters) =>
      ["team", team, "workflows", "list", filters ?? {}] as const,
    detail: (team: string, id: string) =>
      ["team", team, "workflows", "detail", id] as const,
  },
  projects: {
    all: (team: string) => ["team", team, "projects"] as const,
    list: (team: string, filters?: Filters) =>
      ["team", team, "projects", "list", filters ?? {}] as const,
    detail: (team: string, id: string) =>
      ["team", team, "projects", "detail", id] as const,
    taskComments: (team: string, taskId: string) =>
      ["team", team, "projects", "task", taskId, "comments"] as const,
  },
  chat: {
    all: (team: string) => ["team", team, "chat"] as const,
    sessions: (team: string) => ["team", team, "chat", "sessions"] as const,
    session: (team: string, id: string) =>
      ["team", team, "chat", "session", id] as const,
  },
  channels: {
    all: (team: string) => ["team", team, "channels"] as const,
    list: (team: string) => ["team", team, "channels", "list"] as const,
  },
  runs: {
    all: (team: string) => ["team", team, "runs"] as const,
    list: (team: string, filters?: Filters) =>
      ["team", team, "runs", "list", filters ?? {}] as const,
    detail: (team: string, id: string) =>
      ["team", team, "runs", "detail", id] as const,
    steps: (team: string, id: string) =>
      ["team", team, "runs", id, "steps"] as const,
  },
  tools: {
    all: (team: string) => ["team", team, "tools"] as const,
    list: (team: string, filters?: Filters) =>
      ["team", team, "tools", "list", filters ?? {}] as const,
    detail: (team: string, id: string) =>
      ["team", team, "tools", "detail", id] as const,
    catalog: (team: string) => ["team", team, "tools", "catalog"] as const,
  },
  skills: {
    all: (team: string) => ["team", team, "skills"] as const,
    list: (team: string, filters?: Filters) =>
      ["team", team, "skills", "list", filters ?? {}] as const,
  },
  reviews: {
    all: (team: string) => ["team", team, "reviews"] as const,
    list: (team: string, status?: string) =>
      ["team", team, "reviews", "list", status ?? "all"] as const,
  },
  memory: {
    all: (team: string) => ["team", team, "memory"] as const,
    list: (team: string, filters?: Filters) =>
      ["team", team, "memory", "list", filters ?? {}] as const,
    detail: (team: string, id: string) =>
      ["team", team, "memory", "detail", id] as const,
    events: (team: string, memoryId?: string) =>
      ["team", team, "memory", "events", memoryId ?? "all"] as const,
    preview: (team: string, agentId?: string) =>
      ["team", team, "memory", "preview", agentId ?? "none"] as const,
    search: (team: string, query: string) =>
      ["team", team, "memory", "session-search", query] as const,
  },
  observability: {
    traces: (team: string, filters?: Filters) =>
      ["team", team, "observability", "traces", filters ?? {}] as const,
    trace: (team: string, id: string) =>
      ["team", team, "observability", "trace", id] as const,
    metrics: (team: string, filters?: Filters) =>
      ["team", team, "observability", "metrics", filters ?? {}] as const,
  },
  evals: {
    all: (team: string) => ["team", team, "evals"] as const,
    list: (team: string) => ["team", team, "evals", "list"] as const,
    detail: (team: string, id: string) =>
      ["team", team, "evals", "detail", id] as const,
  },
  dashboard: {
    summary: (team: string, range: string, env: string) =>
      ["team", team, "dashboard", "summary", range, env] as const,
  },
  settings: {
    all: (team: string) => ["team", team, "settings"] as const,
    system: (team: string) => ["team", team, "system"] as const,
    environments: (team: string) =>
      ["team", team, "settings", "environments"] as const,
    providers: (team: string) =>
      ["team", team, "settings", "providers"] as const,
  },
  credentials: {
    all: (team: string) => ["team", team, "credentials"] as const,
    list: (team: string) => ["team", team, "credentials", "list"] as const,
  },
  session: {
    me: () => ["session", "me"] as const,
  },
} as const;
