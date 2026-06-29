import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";

const { teams } = schema;

/** Dev tenancy: resolve a team by slug, creating it on first use. */
export async function resolveTeam(slug: string): Promise<string> {
  const existing = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (existing[0]) return existing[0].id;
  const id = genId("team");
  await db.insert(teams).values({ id, slug, name: slug });
  return id;
}
