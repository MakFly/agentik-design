-- Orchestration-native agents: a flag + an explicit subagent roster.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_orchestrator" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_subagents" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"parent_agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
	"subagent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
	"instruction" text,
	"position" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_subagents_parent_child_unique" ON "agent_subagents" ("parent_agent_id","subagent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_subagents_team_parent_idx" ON "agent_subagents" ("team_id","parent_agent_id");
