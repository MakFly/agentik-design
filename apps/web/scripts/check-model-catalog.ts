import { MODEL_CATALOG, MODEL_CATALOG_LAST_VERIFIED } from "@agentik/workflow-schema";

const maxAgeDays = Number(process.env.AGENTIK_MODEL_CATALOG_MAX_AGE_DAYS ?? 30);
const verifiedAt = new Date(`${MODEL_CATALOG_LAST_VERIFIED}T00:00:00.000Z`).getTime();
const now = Date.now();
const ageDays = Math.floor((now - verifiedAt) / 86_400_000);

if (!Number.isFinite(verifiedAt)) {
  throw new Error(`Invalid MODEL_CATALOG_LAST_VERIFIED: ${MODEL_CATALOG_LAST_VERIFIED}`);
}

if (ageDays > maxAgeDays) {
  throw new Error(
    [
      `Model catalog is ${ageDays} days old (max ${maxAgeDays}).`,
      "Refresh packages/workflow-schema/src/models.ts from official provider docs:",
      "- https://developers.openai.com/api/docs/models",
      "- https://platform.claude.com/docs/en/about-claude/models/overview",
      "- https://platform.claude.com/docs/en/about-claude/pricing",
    ].join("\n"),
  );
}

const duplicateIds = MODEL_CATALOG.map((m) => m.model).filter(
  (model, index, models) => models.indexOf(model) !== index,
);

if (duplicateIds.length) {
  throw new Error(`Duplicate model ids: ${[...new Set(duplicateIds)].join(", ")}`);
}

console.log(
  `Model catalog ok: ${MODEL_CATALOG.length} models, verified ${MODEL_CATALOG_LAST_VERIFIED}, age ${ageDays}d.`,
);
