import { z } from "zod";

export const workspaceBody = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9-]+$/,
        "Slug must use lowercase letters, numbers, and hyphens",
      )
      .optional(),
  })
  .refine((d) => d.name !== undefined || d.slug !== undefined, {
    message: "Provide a name or slug to update",
  });

export const memberRoleBody = z.object({
  role: z.enum(["owner", "admin", "engineer", "operator", "viewer"], {
    error: "Invalid role",
  }),
});

export const inviteMemberBody = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  role: z.enum(["owner", "admin", "engineer", "operator", "viewer"], {
    error: "Invalid role",
  }),
});

export const providerPatchBody = z
  .object({
    status: z.enum(["active", "off"]).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((d) => d.status !== undefined || d.isDefault !== undefined, {
    message: "Provide status or isDefault",
  });

export const providersPolicyBody = z.object({
  costCeilingPerDayCents: z
    .number({ error: "Cost ceiling must be a number" })
    .int("Cost ceiling must be a whole number")
    .min(0, "Cost ceiling cannot be negative")
    .optional(),
  fallbackOrder: z.array(z.string()).optional(),
});

export const providerKeyBody = z.object({
  key: z.string().trim().min(8, "API key must be at least 8 characters"),
});

export const environmentColorSchema = z.enum([
  "success",
  "info",
  "warning",
  "danger",
  "muted",
]);

export const environmentIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9_-]+$/,
    "Environment id must use letters, numbers, dashes, or underscores",
  )
  .min(1)
  .max(32);

export const environmentBody = z.object({
  activeId: environmentIdSchema,
  items: z
    .array(
      z.object({
        id: environmentIdSchema,
        label: z.string().trim().min(1).max(40),
        color: environmentColorSchema.default("muted"),
      }),
    )
    .min(1, "Add at least one environment")
    .max(12, "Keep the environment list focused"),
});
