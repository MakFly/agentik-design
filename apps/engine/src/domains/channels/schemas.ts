import { z } from "zod";

const groupPolicy = z.enum(["open", "allowlist", "off"]);
const bindingConfig = z.record(z.string(), z.unknown());

export const createBindingBody = z.object({
  agentId: z.string().trim().min(1).nullable().optional(),
  groupPolicy: groupPolicy.default("off"),
  requireMention: z.boolean().default(true),
  config: bindingConfig.optional(),
});

export const updateBindingBody = z
  .object({
    agentId: z.string().trim().min(1).nullable().optional(),
    groupPolicy: groupPolicy.optional(),
    requireMention: z.boolean().optional(),
    config: bindingConfig.optional(),
    status: z.string().trim().min(1).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateBindingBody = z.infer<typeof createBindingBody>;
export type UpdateBindingBody = z.infer<typeof updateBindingBody>;
