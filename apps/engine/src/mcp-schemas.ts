import { z } from "zod";

export const mcpTransportSchema = z.enum(["streamable_http", "sse"]);

export const createMcpServerBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  transport: mcpTransportSchema.default("streamable_http"),
  url: z.string().trim().url("Enter a valid MCP endpoint URL"),
  credentialId: z.string().trim().min(1).nullable().optional(),
});

export const updateMcpServerBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    transport: mcpTransportSchema.optional(),
    url: z.string().trim().url().optional(),
    credentialId: z.string().trim().min(1).nullable().optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.transport !== undefined ||
      d.url !== undefined ||
      d.credentialId !== undefined,
    { message: "Provide at least one field to update" },
  );

export const invokeToolBody = z.object({
  toolId: z.string().trim().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
  agentId: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).optional(),
});

export type CreateMcpServerInput = z.infer<typeof createMcpServerBody>;
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerBody>;
export type InvokeToolInput = z.infer<typeof invokeToolBody>;
