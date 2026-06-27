ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "last_edited_by" text;
ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "archived_by" text;

CREATE INDEX IF NOT EXISTS "memory_entries_team_created_idx"
  ON "memory_entries" ("team_id", "created_at");
CREATE INDEX IF NOT EXISTS "memory_entries_team_scope_target_idx"
  ON "memory_entries" ("team_id", "scope", "target_id");
CREATE INDEX IF NOT EXISTS "memory_entries_content_fts_idx"
  ON "memory_entries"
  USING gin (to_tsvector('simple', coalesce("content", '')));

CREATE TABLE IF NOT EXISTS "memory_events" (
  "id" text PRIMARY KEY NOT NULL,
  "team_id" text NOT NULL,
  "memory_id" text NOT NULL,
  "action" text NOT NULL,
  "actor_id" text NOT NULL DEFAULT 'system',
  "before" jsonb,
  "after" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "memory_events_team_memory_created_idx"
  ON "memory_events" ("team_id", "memory_id", "created_at");
CREATE INDEX IF NOT EXISTS "chat_messages_content_fts_idx"
  ON "chat_messages"
  USING gin (to_tsvector('simple', coalesce("content", '')));
