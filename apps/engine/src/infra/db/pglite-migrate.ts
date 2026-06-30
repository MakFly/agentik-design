/**
 * Minimal migrator for the embedded PGlite (solo mode). It replays the SAME
 * Postgres migrations the platform uses (apps/engine/drizzle/*.sql) through PGlite's
 * simple-query `exec()` — which, unlike the extended-protocol drizzle migrator,
 * runs multi-statement files. Applied files are tracked so boots are idempotent.
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";
import type { PGlite } from "@electric-sql/pglite";

/** apps/engine/drizzle, resolved relative to this file (src/infra/db). */
function migrationsDir(): string {
  return path.resolve(import.meta.dir, "../../../drizzle");
}

export async function applyPgliteMigrations(pg: PGlite): Promise<number> {
  await pg.exec(
    `CREATE TABLE IF NOT EXISTS _solo_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());`,
  );
  const applied = new Set(
    (await pg.query<{ name: string }>(`SELECT name FROM _solo_migrations`)).rows.map(
      (r) => r.name,
    ),
  );
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    // Drizzle's per-statement marker isn't needed for simple-query exec().
    const sql = readFileSync(path.join(dir, file), "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    );
    await pg.exec(sql);
    await pg.query(`INSERT INTO _solo_migrations (name) VALUES ($1)`, [file]);
    count += 1;
  }
  return count;
}
