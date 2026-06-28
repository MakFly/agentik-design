-- Deterministic rule routing: pin a rule to a specific agent.
ALTER TABLE "assistant_rules" ADD COLUMN IF NOT EXISTS "target_agent_id" text REFERENCES "agents"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_rules_target_agent_idx" ON "assistant_rules" ("target_agent_id");
