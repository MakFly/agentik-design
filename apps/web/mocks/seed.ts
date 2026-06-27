import type { AgentId, TeamId, UserId, VersionId, Money } from "@/types/domain";
import type { AgentRow } from "@/features/agent-registry/types";

const usd = (amountCents: number): Money => ({ amountCents, currency: "USD" });
const team = "team_acme" as TeamId;

interface Seed {
  id: string;
  name: string;
  role: string;
  goal: string;
  model: string;
  health: AgentRow["health"];
  owner: string;
  tags: string[];
  lastRunAt: string | null;
  successRate: number;
  avgLatencyMs: number;
  avgCostCents: number;
  runs24h: number;
}

const SEED: Seed[] = [
  { id: "agt_triage", name: "Triage Agent", role: "Tier-1 triage", goal: "Classify & route tickets", model: "claude-fable-5", health: "healthy", owner: "alice", tags: ["support"], lastRunAt: "2026-05-31T14:22:00Z", successRate: 0.982, avgLatencyMs: 3100, avgCostCents: 4, runs24h: 210 },
  { id: "agt_resolve", name: "Resolve Agent", role: "Resolution", goal: "Resolve billing issues", model: "claude-opus-4-8", health: "healthy", owner: "alice", tags: ["support", "billing"], lastRunAt: "2026-05-31T14:22:00Z", successRate: 0.96, avgLatencyMs: 5400, avgCostCents: 11, runs24h: 142 },
  { id: "agt_scraper", name: "Scraper", role: "Data collection", goal: "Crawl & extract", model: "claude-sonnet-4-6", health: "degraded", owner: "bob", tags: ["data"], lastRunAt: "2026-05-31T14:18:00Z", successRate: 0.713, avgLatencyMs: 2200, avgCostCents: 2, runs24h: 88 },
  { id: "agt_invoice", name: "Invoice Agent", role: "Finance ops", goal: "Generate & send invoices", model: "claude-haiku-4-5", health: "idle", owner: "carol", tags: ["finance"], lastRunAt: "2026-05-31T13:10:00Z", successRate: 0.991, avgLatencyMs: 1200, avgCostCents: 1, runs24h: 30 },
  { id: "agt_classifier", name: "Old Classifier", role: "Legacy", goal: "Classify intents", model: "gpt-5.4-mini", health: "error", owner: "bob", tags: ["legacy"], lastRunAt: "2026-05-31T11:30:00Z", successRate: 0.42, avgLatencyMs: 0, avgCostCents: 0, runs24h: 3 },
  { id: "agt_summarizer", name: "Summarizer", role: "Content", goal: "Summarize long threads", model: "claude-sonnet-4-6", health: "healthy", owner: "carol", tags: ["content"], lastRunAt: "2026-05-31T14:05:00Z", successRate: 0.95, avgLatencyMs: 2800, avgCostCents: 3, runs24h: 64 },
];

export const agents: AgentRow[] = SEED.map((s) => ({
  id: s.id as AgentId,
  teamId: team,
  name: s.name,
  role: s.role,
  goal: s.goal,
  tags: s.tags,
  owner: s.owner as UserId,
  health: s.health,
  model: s.model,
  liveVersionId: `${s.id}_v4` as VersionId,
  draftVersionId: null,
  createdAt: "2026-04-01T09:00:00Z",
  updatedAt: s.lastRunAt ?? "2026-04-01T09:00:00Z",
  createdBy: s.owner as UserId,
  stats: {
    lastRunAt: s.lastRunAt,
    successRate: s.successRate,
    avgLatencyMs: s.avgLatencyMs,
    avgCost: usd(s.avgCostCents),
    runs24h: s.runs24h,
  },
}));
