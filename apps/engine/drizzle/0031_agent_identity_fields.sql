-- Optional display identity for agents (surfaced in roster/graph UIs).
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "emoji" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "color" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "avatar_url" text;
