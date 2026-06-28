-- Add the missing self-referencing FK on runs.parent_run_id (column + index exist
-- since 0030, but no constraint). ON DELETE SET NULL: a deleted/cancelled parent
-- orphans its children rather than leaving them pointing at a ghost run.

-- Null out any pre-existing orphan pointers so the constraint can be added cleanly.
UPDATE "runs" SET "parent_run_id" = NULL
WHERE "parent_run_id" IS NOT NULL
  AND "parent_run_id" NOT IN (SELECT "id" FROM "runs");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'runs_parent_run_id_runs_id_fk'
  ) THEN
    ALTER TABLE "runs"
      ADD CONSTRAINT "runs_parent_run_id_runs_id_fk"
      FOREIGN KEY ("parent_run_id") REFERENCES "runs"("id") ON DELETE SET NULL;
  END IF;
END $$;
