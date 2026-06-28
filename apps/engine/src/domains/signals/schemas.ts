import { z } from "zod";

const jsonObject = z.record(z.string(), z.unknown());

export const createSignalBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80).default("manual"),
  status: z.enum(["active", "disabled"]).default("active"),
  config: jsonObject.default({}),
});

export const updateSignalBody = createSignalBody.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: "Provide at least one field to update" },
);

/** A rule fires exactly one kind of action; the discriminant keeps the payload honest. */
export const ruleAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("orchestrate"), input: z.string().trim().min(1) }),
  z.object({ type: z.literal("run_agent"), input: z.string().trim().min(1) }),
]);

export const createRuleBody = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(["active", "disabled"]).default("active"),
  signalId: z.string().trim().min(1).nullable().optional(),
  targetAgentId: z.string().trim().min(1).nullable().optional(),
  condition: jsonObject.default({}),
  action: ruleAction.optional(),
});

export const updateRuleBody = createRuleBody.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: "Provide at least one field to update" },
);

export const dispatchSignalBody = z.object({
  payload: jsonObject.default({}),
});

export type CreateSignalInput = z.infer<typeof createSignalBody>;
export type UpdateSignalInput = z.infer<typeof updateSignalBody>;
export type CreateRuleInput = z.infer<typeof createRuleBody>;
export type UpdateRuleInput = z.infer<typeof updateRuleBody>;
