import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import { isSolo, soloDbDir } from "../mode";
import * as schema from "./schema";

/**
 * One DB chokepoint, two backends. Solo mode runs embedded PGlite (real Postgres in
 * WASM, persisted under ~/.agentik/db) so the whole engine boots with zero external
 * services; platform mode uses managed Postgres via postgres-js. Both expose the
 * identical Drizzle query surface, so every repo (`import { db }`) is backend-blind.
 *
 * Top-level await: the solo path must create PGlite and apply migrations before the
 * first query, and ESM makes importers wait on this module's TLA — so `db` is always
 * ready when a repo uses it.
 */
async function build(): Promise<PostgresJsDatabase<typeof schema>> {
  if (isSolo) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { applyPgliteMigrations } = await import("./pglite-migrate");
    const dir = soloDbDir();
    const pg = new PGlite(dir);
    await pg.waitReady;
    const applied = await applyPgliteMigrations(pg);
    const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
    console.log(`[engine] solo persistence: PGlite at ${dir} (${applied} migration(s) applied)`);
    // PGlite and postgres-js expose the same Drizzle query API; cast so every repo
    // stays typed against a single Db without a dialect union.
    return drizzlePglite(pg, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
  }

  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required in platform mode (set AGENTIK_MODE=solo for embedded PGlite).",
    );
  }
  const client = postgres(env.DATABASE_URL, { max: 10 });
  return drizzlePg(client, { schema });
}

export const db = await build();
export type Db = typeof db;
/** Either the root pool handle or an open transaction — lets repo helpers compose atomically. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
