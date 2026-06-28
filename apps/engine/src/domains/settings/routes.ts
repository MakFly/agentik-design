import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import { env } from "../../infra/env";
import { jsonValidationError, parseJsonBody } from "../../infra/validation";
import {
  deleteCodexOauth,
  deleteProviderKey,
  getCodexOauthStatus,
  isSupportedProvider,
  listProviderKeys,
  setProviderKey,
} from "../settings/providers-repo";
import {
  environmentBody,
  inviteMemberBody,
  memberRoleBody,
  providerKeyBody,
  providerPatchBody,
  providersPolicyBody,
  routerBody,
  workspaceBody,
} from "./schemas";
import {
  getEnvironmentSettings,
  getProvidersSettings,
  getRouterSettings,
  getWorkspaceSettings,
  inviteTeamMember,
  listTeamInvitations,
  listTeamMembers,
  removeTeamMember,
  revokeTeamInvitation,
  testProviderConnection,
  updateEnvironmentSettings,
  updateProviderConfig,
  updateProvidersPolicy,
  updateRouterSettings,
  updateTeamMemberRole,
  updateWorkspaceSettings,
} from "./repo";

export const settingsRoutes = new Hono<{ Variables: AuthVars }>();

settingsRoutes.get("/settings/workspace", requirePermission("settings:read"), async (c) => {
  const ws = await getWorkspaceSettings(c.get("teamId"));
  if (!ws) return c.json({ error: "not_found" }, 404);
  return c.json(ws);
});

settingsRoutes.patch("/settings/workspace", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(workspaceBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const res = await updateWorkspaceSettings(
    c.get("teamId"),
    c.get("auth").userId,
    parsed.data,
  );
  if ("error" in res) {
    const status =
      res.error === "forbidden" ? 403 : res.error === "slug_taken" ? 409 : 400;
    return c.json({ error: res.error }, status);
  }
  return c.json(res);
});

settingsRoutes.get("/settings/environments", requirePermission("settings:read"), async (c) => {
  return c.json(await getEnvironmentSettings(c.get("teamId")));
});

settingsRoutes.patch("/settings/environments", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(environmentBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const res = await updateEnvironmentSettings(c.get("teamId"), parsed.data);
  if ("error" in res) return c.json({ error: res.error }, 400);
  return c.json(res);
});

settingsRoutes.get("/settings/members", requirePermission("settings:read"), async (c) => {
  return c.json({ items: await listTeamMembers(c.get("teamId")) });
});

settingsRoutes.patch(
  "/settings/members/:userId",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(memberRoleBody, await c.req.json().catch(() => null));
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateTeamMemberRole(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("userId"),
      parsed.data.role,
    );
    if ("error" in res) {
      const status =
        res.error === "forbidden" ? 403 : res.error === "last_owner" ? 409 : 404;
      return c.json({ error: res.error }, status);
    }
    return c.json(res);
  },
);

settingsRoutes.delete(
  "/settings/members/:userId",
  requirePermission("settings:update"),
  async (c) => {
    const res = await removeTeamMember(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("userId"),
    );
    if ("error" in res) {
      const status =
        res.error === "forbidden" ? 403 : res.error === "last_owner" ? 409 : 404;
      return c.json({ error: res.error }, status);
    }
    return c.json(res);
  },
);

settingsRoutes.get("/settings/invitations", requirePermission("settings:read"), async (c) => {
  return c.json({ items: await listTeamInvitations(c.get("teamId")) });
});

settingsRoutes.post("/settings/invitations", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(inviteMemberBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const res = await inviteTeamMember(
    c.get("teamId"),
    c.get("auth").userId,
    parsed.data.email,
    parsed.data.role,
  );
  if ("error" in res) return c.json({ error: res.error }, 403);
  const acceptUrl = `${env.WEB_PUBLIC_URL}/invite?token=${res.token}`;
  return c.json({ id: res.id, expiresAt: res.expiresAt, acceptUrl }, 201);
});

settingsRoutes.delete(
  "/settings/invitations/:id",
  requirePermission("settings:update"),
  async (c) => {
    const res = await revokeTeamInvitation(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("id"),
    );
    if ("error" in res) return c.json({ error: res.error }, 404);
    return c.json(res);
  },
);

settingsRoutes.get("/settings/providers", requirePermission("settings:read"), async (c) => {
  return c.json(await getProvidersSettings(c.get("teamId")));
});

settingsRoutes.patch(
  "/settings/providers/:id",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(providerPatchBody, await c.req.json().catch(() => null));
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateProviderConfig(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("id"),
      parsed.data,
    );
    if ("error" in res) return c.json({ error: res.error }, 403);
    return c.json(res);
  },
);

settingsRoutes.patch(
  "/settings/providers-policy",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(providersPolicyBody, await c.req.json().catch(() => null));
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateProvidersPolicy(
      c.get("teamId"),
      c.get("auth").userId,
      parsed.data,
    );
    if ("error" in res) return c.json({ error: res.error }, 403);
    return c.json(res);
  },
);

settingsRoutes.post(
  "/settings/providers/:id/test",
  requirePermission("settings:update"),
  async (c) => {
    return c.json(await testProviderConnection(c.get("teamId"), c.req.param("id")));
  },
);

settingsRoutes.get("/settings/router", requirePermission("settings:read"), async (c) => {
  return c.json(await getRouterSettings(c.get("teamId")));
});

settingsRoutes.patch("/settings/router", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(routerBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const res = await updateRouterSettings(
    c.get("teamId"),
    c.get("auth").userId,
    parsed.data,
  );
  if ("error" in res) {
    return c.json({ error: res.error }, res.error === "forbidden" ? 403 : 400);
  }
  return c.json(res);
});

settingsRoutes.get("/settings/oauth", requirePermission("settings:read"), async (c) => {
  return c.json({ codex: await getCodexOauthStatus(c.get("teamId")) });
});

settingsRoutes.delete(
  "/settings/oauth/codex",
  requirePermission("settings:delete"),
  async (c) => {
    await deleteCodexOauth(c.get("teamId"));
    return c.json({ ok: true });
  },
);

settingsRoutes.get("/settings/provider-keys", requirePermission("settings:read"), async (c) => {
  return c.json({ items: await listProviderKeys(c.get("teamId")) });
});

settingsRoutes.put(
  "/settings/provider-keys/:provider",
  requirePermission("settings:update"),
  async (c) => {
    const provider = c.req.param("provider");
    if (!isSupportedProvider(provider))
      return c.json({ error: "unsupported_provider" }, 400);
    const parsed = parseJsonBody(providerKeyBody, await c.req.json().catch(() => null));
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    await setProviderKey(c.get("teamId"), provider, parsed.data.key);
    return c.json({ ok: true });
  },
);

settingsRoutes.delete(
  "/settings/provider-keys/:provider",
  requirePermission("settings:delete"),
  async (c) => {
    await deleteProviderKey(c.get("teamId"), c.req.param("provider"));
    return c.json({ ok: true });
  },
);
