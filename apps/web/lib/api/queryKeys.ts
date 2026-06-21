/**
 * Hierarchical, team-scoped query-key factory (docs/03 §7.3).
 * Invalidate by prefix: queryClient.invalidateQueries({ queryKey: qk.agents.all(team) }).
 */

export type Filters = object | undefined;

export const qk = {
  agents: {
    all: (team: string) => ["team", team, "agents"] as const,
    list: (team: string, filters?: Filters) => ["team", team, "agents", "list", filters ?? {}] as const,
    detail: (team: string, id: string) => ["team", team, "agents", "detail", id] as const,
    versions: (team: string, id: string) => ["team", team, "agents", id, "versions"] as const,
    snapshot: (team: string) => ["team", team, "agents", "snapshot"] as const,
  },
  workflows: {
    all: (team: string) => ["team", team, "workflows"] as const,
    list: (team: string, filters?: Filters) => ["team", team, "workflows", "list", filters ?? {}] as const,
    detail: (team: string, id: string) => ["team", team, "workflows", "detail", id] as const,
  },
  runs: {
    all: (team: string) => ["team", team, "runs"] as const,
    list: (team: string, filters?: Filters) => ["team", team, "runs", "list", filters ?? {}] as const,
    detail: (team: string, id: string) => ["team", team, "runs", "detail", id] as const,
    steps: (team: string, id: string) => ["team", team, "runs", id, "steps"] as const,
  },
  tools: {
    all: (team: string) => ["team", team, "tools"] as const,
    list: (team: string, filters?: Filters) => ["team", team, "tools", "list", filters ?? {}] as const,
    detail: (team: string, id: string) => ["team", team, "tools", "detail", id] as const,
    catalog: (team: string) => ["team", team, "tools", "catalog"] as const,
  },
  memory: {
    all: (team: string) => ["team", team, "memory"] as const,
    list: (team: string) => ["team", team, "memory", "list"] as const,
    detail: (team: string, id: string) => ["team", team, "memory", "detail", id] as const,
    search: (team: string, id: string, query: string) => ["team", team, "memory", id, "search", query] as const,
  },
  observability: {
    traces: (team: string, filters?: Filters) => ["team", team, "observability", "traces", filters ?? {}] as const,
    trace: (team: string, id: string) => ["team", team, "observability", "trace", id] as const,
    metrics: (team: string, filters?: Filters) => ["team", team, "observability", "metrics", filters ?? {}] as const,
  },
  evals: {
    all: (team: string) => ["team", team, "evals"] as const,
    list: (team: string) => ["team", team, "evals", "list"] as const,
    detail: (team: string, id: string) => ["team", team, "evals", "detail", id] as const,
  },
  dashboard: {
    summary: (team: string, range: string, env: string) =>
      ["team", team, "dashboard", "summary", range, env] as const,
  },
  settings: {
    all: (team: string) => ["team", team, "settings"] as const,
    members: (team: string) => ["team", team, "settings", "members"] as const,
    providers: (team: string) => ["team", team, "settings", "providers"] as const,
    apiKeys: (team: string) => ["team", team, "settings", "apiKeys"] as const,
    billing: (team: string) => ["team", team, "settings", "billing"] as const,
    security: (team: string) => ["team", team, "settings", "security"] as const,
    audit: (team: string, filters?: Filters) => ["team", team, "settings", "audit", filters ?? {}] as const,
  },
  credentials: {
    all: (team: string) => ["team", team, "credentials"] as const,
    list: (team: string) => ["team", team, "credentials", "list"] as const,
  },
  session: {
    me: () => ["session", "me"] as const,
  },
} as const;
