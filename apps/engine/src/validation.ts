import type { Context } from "hono";
import type { ZodError, ZodSchema } from "zod";

export function jsonValidationError(c: Context, error: ZodError) {
  return c.json({ error: "invalid_body", detail: error.issues }, 400);
}

export function parseJsonBody<T>(schema: ZodSchema<T>, body: unknown) {
  return schema.safeParse(body);
}
