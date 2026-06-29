-- Agent ownership for B2B compliance: who created the agent. Null for system-seeded.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "creator_id" text;
CREATE INDEX IF NOT EXISTS "agents_creator_id_idx" ON "agents" ("creator_id");
