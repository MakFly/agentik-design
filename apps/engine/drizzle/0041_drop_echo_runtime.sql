-- Remove the mock "echo" runtime. Every agent must now run on a real LLM runtime
-- (claude/codex/hermes/…), which always requires an API key or OAuth (codex/claude code).
-- No self-contained mock fallback remains.

-- Flip column defaults off the deleted "echo" kind.
ALTER TABLE "agents" ALTER COLUMN "runtime_kind" SET DEFAULT 'claude';
ALTER TABLE "agent_versions" ALTER COLUMN "runtime_kind" SET DEFAULT 'claude';

-- Migrate existing rows that still point at the removed runtime.
UPDATE "agents" SET "runtime_kind" = 'claude' WHERE "runtime_kind" = 'echo';
UPDATE "agent_versions" SET "runtime_kind" = 'claude' WHERE "runtime_kind" = 'echo';

-- Drop orphaned daemon runtime registrations for the removed kind (destructive, but
-- these reference a runtime no daemon ships anymore, so they can never claim a task).
DELETE FROM "runtimes" WHERE "kind" = 'echo';
