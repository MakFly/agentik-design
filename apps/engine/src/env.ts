import { z } from "zod";

/** Bun auto-loads `.env`. Validate it once at boot so misconfig fails loudly. */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  OPENAI_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid engine environment:\n", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
