CREATE TABLE "agent_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"runtime_id" text,
	"daemon_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"input" jsonb,
	"work_dir" text,
	"result" jsonb,
	"error" text,
	"step_count" integer DEFAULT 0 NOT NULL,
	"completed_steps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"health" text DEFAULT 'idle' NOT NULL,
	"runtime_kind" text DEFAULT 'echo' NOT NULL,
	"live_version_id" text,
	"draft_version_id" text,
	"config" jsonb,
	"max_concurrent_tasks" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daemons" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtimes" (
	"id" text PRIMARY KEY NOT NULL,
	"daemon_id" text NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"capabilities" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"tool" text,
	"content" text,
	"input" jsonb,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_messages_task_seq_unique" UNIQUE("task_id","seq")
);
--> statement-breakpoint
ALTER TABLE "runtimes" ADD CONSTRAINT "runtimes_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;