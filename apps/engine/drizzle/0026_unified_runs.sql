-- Phase 2: unify agent_tasks into runs; rename task_messages → run_messages

ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "executor" text DEFAULT 'workflow' NOT NULL;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "agent_id" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "project_task_id" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "runtime_id" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "daemon_id" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "priority" integer;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "input" jsonb;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "work_dir" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "result" jsonb;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "error_reason" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "attempt" integer;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "chat_session_id" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "dispatched_at" timestamp with time zone;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;

UPDATE "runs" SET "created_at" = "started_at";

ALTER TABLE "runs" ALTER COLUMN "workflow_id" DROP NOT NULL;
ALTER TABLE "runs" ALTER COLUMN "version_id" DROP NOT NULL;

INSERT INTO "runs" (
  "id",
  "team_id",
  "workflow_id",
  "version_id",
  "status",
  "trigger",
  "payload",
  "error",
  "started_at",
  "ended_at",
  "duration_ms",
  "step_count",
  "completed_steps",
  "executor",
  "agent_id",
  "project_id",
  "project_task_id",
  "runtime_id",
  "daemon_id",
  "priority",
  "kind",
  "input",
  "work_dir",
  "result",
  "error_reason",
  "attempt",
  "chat_session_id",
  "dispatched_at",
  "created_at"
)
SELECT
  replace("id", 'atask_', 'run_'),
  "team_id",
  NULL,
  NULL,
  CASE "status"
    WHEN 'completed' THEN 'succeeded'
    WHEN 'dispatched' THEN 'queued'
    ELSE "status"
  END,
  CASE WHEN "kind" = 'direct' THEN 'api' ELSE 'manual' END,
  NULL,
  "error",
  COALESCE("started_at", "created_at"),
  "ended_at",
  "duration_ms",
  "step_count",
  "completed_steps",
  'daemon',
  "agent_id",
  "project_id",
  "project_task_id",
  "runtime_id",
  "daemon_id",
  "priority",
  "kind",
  "input",
  "work_dir",
  "result",
  "error_reason",
  "attempt",
  "chat_session_id",
  "dispatched_at",
  "created_at"
FROM "agent_tasks";

UPDATE "chat_messages"
SET "task_id" = replace("task_id", 'atask_', 'run_')
WHERE "task_id" LIKE 'atask_%';

UPDATE "memory_entries"
SET "source_run_id" = replace("source_run_id", 'atask_', 'run_')
WHERE "source_run_id" LIKE 'atask_%';

UPDATE "run_reviews"
SET "run_id" = replace("run_id", 'atask_', 'run_')
WHERE "run_id" LIKE 'atask_%';

UPDATE "skill_versions"
SET "source_run_id" = replace("source_run_id", 'atask_', 'run_')
WHERE "source_run_id" LIKE 'atask_%';

UPDATE "project_tasks"
SET "last_run_id" = replace("last_run_id", 'atask_', 'run_')
WHERE "last_run_id" LIKE 'atask_%';

UPDATE "channel_messages"
SET "run_id" = replace("run_id", 'atask_', 'run_')
WHERE "run_id" LIKE 'atask_%';

UPDATE "project_task_comments"
SET "run_id" = replace("run_id", 'atask_', 'run_')
WHERE "run_id" LIKE 'atask_%';

UPDATE "task_messages"
SET "task_id" = replace("task_id", 'atask_', 'run_')
WHERE "task_id" LIKE 'atask_%';

ALTER TABLE "task_messages" DROP CONSTRAINT "task_messages_task_id_agent_tasks_id_fk";

ALTER TABLE "task_messages" RENAME TO "run_messages";
ALTER TABLE "run_messages" RENAME COLUMN "task_id" TO "run_id";
ALTER TABLE "run_messages" RENAME CONSTRAINT "task_messages_task_seq_unique" TO "run_messages_run_seq_unique";

ALTER TABLE "run_messages" ADD CONSTRAINT "run_messages_run_id_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "agent_tasks" DROP CONSTRAINT IF EXISTS "agent_tasks_project_id_projects_id_fk";
ALTER TABLE "agent_tasks" DROP CONSTRAINT IF EXISTS "agent_tasks_project_task_id_project_tasks_id_fk";

DROP TABLE "agent_tasks";

ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "runs" ADD CONSTRAINT "runs_project_task_id_project_tasks_id_fk"
  FOREIGN KEY ("project_task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;
