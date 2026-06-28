CREATE TABLE IF NOT EXISTS "run_events" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "type" text NOT NULL,
  "actor" jsonb NOT NULL,
  "tool_call_id" text,
  "parent_event_id" text,
  "payload" jsonb NOT NULL,
  "contract_event" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "run_events_run_seq_unique" UNIQUE("run_id","seq")
);

CREATE INDEX IF NOT EXISTS "run_events_run_id_idx" ON "run_events" ("run_id");
CREATE INDEX IF NOT EXISTS "run_events_tool_call_id_idx" ON "run_events" ("tool_call_id");
