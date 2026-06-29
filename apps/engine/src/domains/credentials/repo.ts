import { and, desc, eq, sql } from "drizzle-orm";
import type { CreateCredentialInput, CredentialSummary } from "@agentik/workflow-schema";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { decryptJson, encryptJson } from "../../infra/crypto";

const { credentials } = schema;

function toCredentialSummary(c: typeof credentials.$inferSelect, connected = false): CredentialSummary {
  return {
    id: c.id,
    teamId: c.teamId,
    type: c.type as CredentialSummary["type"],
    name: c.name,
    connected,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** A credential is "connected" once an OAuth access token has been stored. */
function isConnected(row: typeof credentials.$inferSelect): boolean {
  try {
    return Boolean(decryptJson<Record<string, string>>(row.data).access_token);
  } catch {
    return false;
  }
}

export async function createCredential(
  teamId: string,
  input: CreateCredentialInput,
): Promise<CredentialSummary> {
  const id = genId("cred");
  const [row] = await db
    .insert(credentials)
    .values({ id, teamId, type: input.type, name: input.name, data: encryptJson(input.data) })
    .returning();
  return toCredentialSummary(row!, isConnected(row!));
}

export async function listCredentials(teamId: string): Promise<CredentialSummary[]> {
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.teamId, teamId))
    .orderBy(desc(credentials.createdAt));
  return rows.map((r) => toCredentialSummary(r, isConnected(r)));
}

/** Decrypt a credential by id (for OAuth routes / token refresh). */
export async function getCredentialDecrypted(
  teamId: string,
  id: string,
): Promise<{ row: typeof credentials.$inferSelect; data: Record<string, string> } | null> {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.teamId, teamId)))
    .limit(1);
  if (!row) return null;
  return { row, data: decryptJson<Record<string, string>>(row.data) };
}

/** Re-encrypt and persist a credential's secret payload. */
export async function setCredentialData(teamId: string, id: string, data: Record<string, string>): Promise<void> {
  await db
    .update(credentials)
    .set({ data: encryptJson(data), updatedAt: sql`now()` })
    .where(and(eq(credentials.id, id), eq(credentials.teamId, teamId)));
}

export async function deleteCredential(teamId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.teamId, teamId)))
    .returning({ id: credentials.id });
  return deleted.length > 0;
}
