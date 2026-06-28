import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(client, { schema });
export type Db = typeof db;
/** Either the root pool handle or an open transaction — lets repo helpers compose atomically. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
