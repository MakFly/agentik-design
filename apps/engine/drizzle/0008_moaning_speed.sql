ALTER TABLE "agent_tasks" ADD COLUMN "error_reason" text;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;