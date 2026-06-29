-- Hot-path indexes for server-side listing/filtering (P2-2): the agents registry
-- query (team + recency), the per-agent run stats join, and the runs board filter.
CREATE INDEX IF NOT EXISTS "agents_team_updated_idx" ON "agents" ("team_id", "updated_at");
CREATE INDEX IF NOT EXISTS "runs_team_agent_idx" ON "runs" ("team_id", "agent_id");
CREATE INDEX IF NOT EXISTS "runs_team_status_created_idx" ON "runs" ("team_id", "status", "created_at");
