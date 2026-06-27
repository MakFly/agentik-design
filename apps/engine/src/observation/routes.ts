import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../app/middleware/auth";
import { env } from "../infra/env";
import {
  enqueueBundleCommand,
  getNetworkInstallEnabled,
  listBundleCommands,
  setNetworkInstallEnabled,
} from "../execution/bundle/repo";
import { deleteDaemon } from "../execution/daemon/repo";
import type { BundleAction } from "../infra/db/schema";
import {
  getUserDaemonTokenStatus,
  listUserDaemonOrgs,
  markUserPersonalDaemonsOffline,
  revokeUserDaemonToken,
  rotateUserDaemonToken,
} from "../gateway/auth-repo";
import { getSystemInfo } from "./system-info";
import { listTraces, getTrace } from "./traces";

const BUNDLE_ACTIONS: BundleAction[] = ["install", "upgrade", "uninstall"];

export const observationRoutes = new Hono<{ Variables: AuthVars }>();

observationRoutes.get("/system", async (c) => {
  const info = await getSystemInfo(c.get("teamId"));
  return c.json({
    daemonEnabled: env.DAEMON_ENABLED,
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(env.OPENAI_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      google: Boolean(env.GOOGLE_CLIENT_ID),
    },
    ...info,
  });
});

observationRoutes.delete("/daemons/:id", requirePermission("settings:update"), async (c) => {
  const res = await deleteDaemon(c.get("teamId"), c.req.param("id"));
  if (res.ok) return c.json({ ok: true });
  const status = res.reason === "not_found" ? 404 : 409;
  return c.json({ ok: false, reason: res.reason }, status);
});

observationRoutes.get("/me/daemon-token", async (c) => {
  const [status, orgs] = await Promise.all([
    getUserDaemonTokenStatus(c.get("auth").userId),
    listUserDaemonOrgs(c.get("auth").userId),
  ]);
  if (!status) return c.json({ error: "not_found" }, 404);
  return c.json({ ...status, eligibleOrgs: orgs });
});

observationRoutes.post("/me/daemon-token/rotate", async (c) => {
  const [rotated, orgs] = await Promise.all([
    rotateUserDaemonToken(c.get("auth").userId),
    listUserDaemonOrgs(c.get("auth").userId),
  ]);
  if (!rotated) return c.json({ error: "not_found" }, 404);
  return c.json({ ...rotated, eligibleOrgs: orgs }, 201);
});

observationRoutes.delete("/me/daemon-token", async (c) => {
  await revokeUserDaemonToken(c.get("auth").userId);
  return c.json({ ok: true });
});

observationRoutes.post("/me/daemon-token/offline", async (c) => {
  const count = await markUserPersonalDaemonsOffline(c.get("auth").userId);
  return c.json({ ok: true, count });
});

observationRoutes.get("/bundles", requirePermission("settings:read"), async (c) => {
  const teamId = c.get("teamId");
  const [networkInstall, items] = await Promise.all([
    getNetworkInstallEnabled(teamId),
    listBundleCommands(teamId),
  ]);
  return c.json({ policy: { networkInstall }, items });
});

observationRoutes.put("/bundles/policy", requirePermission("settings:update"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    networkInstall?: unknown;
  } | null;
  if (typeof body?.networkInstall !== "boolean")
    return c.json({ error: "invalid_body" }, 400);
  await setNetworkInstallEnabled(c.get("teamId"), body.networkInstall);
  return c.json({ networkInstall: body.networkInstall });
});

observationRoutes.post("/bundles", requirePermission("settings:update"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    daemonId?: string;
    kind?: string;
    action?: BundleAction;
  } | null;
  if (
    !body?.daemonId ||
    !body.kind ||
    !body.action ||
    !BUNDLE_ACTIONS.includes(body.action)
  ) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const res = await enqueueBundleCommand(c.get("teamId"), {
    daemonId: body.daemonId,
    kind: body.kind,
    action: body.action,
    requestedBy: c.get("auth").userId,
  });
  if (!res.ok) {
    const status =
      res.error === "daemon_not_found"
        ? 404
        : res.error === "network_install_disabled"
          ? 403
          : 409;
    return c.json({ error: res.error }, status);
  }
  return c.json(res.command, 202);
});

observationRoutes.get("/observability/traces", async (c) => {
  const body = await listTraces(c.get("teamId"), {
    env: c.req.query("env") ?? undefined,
    status: c.req.query("status") ?? undefined,
    q: c.req.query("q") ?? undefined,
  });
  return c.json(body);
});

observationRoutes.get("/observability/traces/:id", async (c) => {
  const detail = await getTrace(c.get("teamId"), c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});
