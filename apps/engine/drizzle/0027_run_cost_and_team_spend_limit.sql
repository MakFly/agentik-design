-- Realized per-run cost in integer cents (USD), extracted from the runtime's
-- reported cost_usd at completion. Drives per-team monthly spend enforcement.
-- The team spend ceiling itself lives in teams.settings.providers.monthlySpendLimitCents
-- (jsonb, no column needed — consistent with the existing costCeilingPerDayCents).
ALTER TABLE "runs" ADD COLUMN "cost_cents" integer;
