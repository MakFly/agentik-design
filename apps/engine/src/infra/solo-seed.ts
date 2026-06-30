/**
 * Solo first-boot seed: one team + one local user + their membership, so the
 * single-tenant local install works in the browser with no signup/login. The team
 * slug matches the dev-header tenancy fallback (resolveAuth → x-team ?? "acme") and
 * `me` returns the local user in solo mode (see gateway/routes/auth.ts). Idempotent.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { SOLO_TEAM_SLUG } from "./mode";

/** Stable ids so the seed is idempotent and `me` can resolve the local user. */
const SOLO_USER_ID = "usr_solo_local";
const SOLO_USER_EMAIL = "you@agentik.local";

export async function ensureSoloSeed(): Promise<void> {
  let team = (
    await db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.slug, SOLO_TEAM_SLUG))
      .limit(1)
  )[0];
  if (!team) {
    const id = genId("team");
    await db.insert(schema.teams).values({ id, slug: SOLO_TEAM_SLUG, name: "Personal" });
    team = { id };
    console.log(`[engine] solo seed: created team '${SOLO_TEAM_SLUG}'`);
  }

  const hasUser = (
    await db
      .select({ id: schema.appUsers.id })
      .from(schema.appUsers)
      .where(eq(schema.appUsers.id, SOLO_USER_ID))
      .limit(1)
  )[0];
  if (!hasUser) {
    await db.insert(schema.appUsers).values({
      id: SOLO_USER_ID,
      email: SOLO_USER_EMAIL,
      // Solo never logs in via password; tenancy is local + single-user.
      passwordHash: "solo-local-no-login",
      name: "You",
      emailVerifiedAt: new Date().toISOString(),
    });
  }

  await db
    .insert(schema.orgMembers)
    .values({ id: "omem_solo_local", teamId: team.id, userId: SOLO_USER_ID, role: "owner" })
    .onConflictDoNothing();
}

/** The local user, shaped like getSessionUser(), for `me` in solo mode. */
export async function soloUser() {
  const [row] = await db
    .select({
      userId: schema.appUsers.id,
      email: schema.appUsers.email,
      name: schema.appUsers.name,
      emailVerifiedAt: schema.appUsers.emailVerifiedAt,
      onboardingQuestionnaire: schema.appUsers.onboardingQuestionnaire,
    })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.id, SOLO_USER_ID))
    .limit(1);
  return row ?? null;
}
