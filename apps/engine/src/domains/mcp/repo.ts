import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { getCredentialDecrypted } from "../workflows/repo";
import type { CreateMcpServerInput, UpdateMcpServerInput } from "./schemas";
import type { McpTransport, ToolGrantRecord } from "../../infra/db/schema";

const { mcpServers, mcpTools, agents, agentVersions, runs } = schema;

export interface ToolCatalogItem {
  toolId: string;
  name: string;
  label: string;
  description: string;
  source: "built-in" | "http" | "mcp";
  serverId?: string;
  serverName?: string;
  inputSchema?: Record<string, unknown>;
  scopes: string[];
  status: "available" | "unavailable";
}

export interface RuntimeToolDefinition {
  toolId: string;
  callName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scopes: string[];
  requireApproval?: boolean;
}

const BUILTIN_TOOL_CATALOG: ToolCatalogItem[] = [
  {
    toolId: "get_weather",
    name: "get_weather",
    label: "Get weather",
    description: "Current weather for any place by name.",
    source: "built-in",
    scopes: ["read"],
    status: "available",
  },
];

function mcpToolId(serverId: string, toolName: string) {
  return `mcp:${serverId}:${toolName}`;
}

function callNameForToolId(toolId: string) {
  return toolId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function credentialHeaders(teamId: string, credentialId?: string | null) {
  if (!credentialId) return {};
  const cred = await getCredentialDecrypted(teamId, credentialId);
  if (!cred) return {};
  const headers: Record<string, string> = {};
  const rawHeaders = cred.data.headers;
  if (rawHeaders) {
    try {
      const parsed = JSON.parse(rawHeaders) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && key.trim()) headers[key] = value;
      }
    } catch {
      // Ignore malformed optional headers; bearer/authorization still work.
    }
  }
  const bearer = cred.data.bearerToken ?? cred.data.access_token;
  if (cred.data.authorization) headers.authorization = cred.data.authorization;
  else if (bearer) headers.authorization = `Bearer ${bearer}`;
  return headers;
}

async function withMcpClient<T>(
  input: {
    teamId: string;
    url: string;
    transport: McpTransport;
    credentialId?: string | null;
  },
  fn: (client: Client) => Promise<T>,
) {
  const headers = await credentialHeaders(input.teamId, input.credentialId);
  const requestInit = Object.keys(headers).length ? { headers } : undefined;
  const client = new Client({ name: "agentik-engine", version: "0.1.0" });
  const url = new URL(input.url);
  const transport =
    input.transport === "sse"
      ? new SSEClientTransport(url, { requestInit })
      : new StreamableHTTPClientTransport(url, { requestInit });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export async function listMcpServers(teamId: string) {
  const servers = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.teamId, teamId))
    .orderBy(desc(mcpServers.updatedAt));

  const counts = await Promise.all(
    servers.map(async (server) => {
      const rows = await db
        .select({ id: mcpTools.id })
        .from(mcpTools)
        .where(and(eq(mcpTools.teamId, teamId), eq(mcpTools.serverId, server.id)));
      return [server.id, rows.length] as const;
    }),
  );
  const countByServer = new Map(counts);
  return servers.map((server) => ({ ...server, toolCount: countByServer.get(server.id) ?? 0 }));
}

export async function getMcpServer(teamId: string, id: string) {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.id, id)))
    .limit(1);
  if (!server) return null;
  const tools = await db
    .select()
    .from(mcpTools)
    .where(and(eq(mcpTools.teamId, teamId), eq(mcpTools.serverId, id)))
    .orderBy(mcpTools.name);
  return { ...server, tools };
}

export async function createMcpServer(teamId: string, input: CreateMcpServerInput) {
  const id = genId("mcp");
  const [server] = await db
    .insert(mcpServers)
    .values({
      id,
      teamId,
      name: input.name,
      transport: input.transport,
      url: input.url,
      credentialId: input.credentialId ?? null,
    })
    .returning();
  return server!;
}

export async function updateMcpServer(teamId: string, id: string, input: UpdateMcpServerInput) {
  const [server] = await db
    .update(mcpServers)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.transport !== undefined ? { transport: input.transport } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.credentialId !== undefined ? { credentialId: input.credentialId } : {}),
      status: "unknown",
      lastError: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.id, id)))
    .returning();
  return server ?? null;
}

export async function deleteMcpServer(teamId: string, id: string) {
  const rows = await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.id, id)))
    .returning({ id: mcpServers.id });
  return rows.length > 0;
}

export async function testMcpServer(teamId: string, id: string) {
  const detail = await getMcpServer(teamId, id);
  if (!detail) return null;
  try {
    const result = await withMcpClient(detail, (client) => client.listTools());
    await db
      .update(mcpServers)
      .set({ status: "online", lastError: null, updatedAt: sql`now()` })
      .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.id, id)));
    return { ok: true as const, toolCount: result.tools.length };
  } catch (err) {
    const message = errorMessage(err);
    await db
      .update(mcpServers)
      .set({ status: "error", lastError: message, updatedAt: sql`now()` })
      .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.id, id)));
    return { ok: false as const, error: message };
  }
}

export async function syncMcpServer(teamId: string, id: string) {
  const detail = await getMcpServer(teamId, id);
  if (!detail) return null;
  try {
    const result = await withMcpClient(detail, (client) => client.listTools());
    await db.transaction(async (tx) => {
      await tx
        .delete(mcpTools)
        .where(and(eq(mcpTools.teamId, teamId), eq(mcpTools.serverId, id)));
      if (result.tools.length > 0) {
        await tx.insert(mcpTools).values(
          result.tools.map((tool) => ({
            id: genId("mtool"),
            teamId,
            serverId: id,
            toolId: mcpToolId(id, tool.name),
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
            status: "available" as const,
          })),
        );
      }
      await tx
        .update(mcpServers)
        .set({
          status: "online",
          lastError: null,
          lastSyncAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.id, id)));
    });
    return getMcpServer(teamId, id);
  } catch (err) {
    const message = errorMessage(err);
    await db
      .update(mcpServers)
      .set({ status: "error", lastError: message, updatedAt: sql`now()` })
      .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.id, id)));
    return { error: message };
  }
}

export async function listToolCatalog(teamId: string): Promise<ToolCatalogItem[]> {
  const rows = await db
    .select({
      toolId: mcpTools.toolId,
      name: mcpTools.name,
      description: mcpTools.description,
      inputSchema: mcpTools.inputSchema,
      status: mcpTools.status,
      serverId: mcpServers.id,
      serverName: mcpServers.name,
    })
    .from(mcpTools)
    .innerJoin(mcpServers, eq(mcpTools.serverId, mcpServers.id))
    .where(eq(mcpTools.teamId, teamId))
    .orderBy(mcpServers.name, mcpTools.name);

  return [
    ...BUILTIN_TOOL_CATALOG,
    ...rows.map((row) => ({
      toolId: row.toolId,
      name: row.name,
      label: row.name,
      description: row.description,
      source: "mcp" as const,
      serverId: row.serverId,
      serverName: row.serverName,
      inputSchema: row.inputSchema,
      scopes: ["read", "write", "admin"],
      status: row.status,
    })),
  ];
}

async function resolveAgentIdForInvocation(teamId: string, input: { agentId?: string; runId?: string }) {
  if (input.agentId) return input.agentId;
  if (!input.runId) return null;
  const [task] = await db
    .select({ agentId: runs.agentId })
    .from(runs)
    .where(and(eq(runs.teamId, teamId), eq(runs.id, input.runId)))
    .limit(1);
  return task?.agentId ?? null;
}

export async function agentHasToolGrant(
  teamId: string,
  input: { agentId?: string; runId?: string; toolId: string },
) {
  const agentId = await resolveAgentIdForInvocation(teamId, input);
  if (!agentId) return false;
  const [agent] = await db
    .select({ liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  if (!agent?.liveVersionId) return false;
  const [version] = await db
    .select({ grants: agentVersions.toolGrants, tools: agentVersions.tools })
    .from(agentVersions)
    .where(eq(agentVersions.id, agent.liveVersionId))
    .limit(1);
  if (!version) return false;
  return (
    version.grants.some((grant) => grant.toolId === input.toolId) ||
    version.tools.includes(input.toolId)
  );
}

export async function invokeMcpTool(
  teamId: string,
  input: { toolId: string; arguments?: Record<string, unknown>; agentId?: string; runId?: string },
) {
  if (!(await agentHasToolGrant(teamId, input))) return { error: "tool_not_granted" as const };
  const [tool] = await db
    .select({
      name: mcpTools.name,
      server: mcpServers,
    })
    .from(mcpTools)
    .innerJoin(mcpServers, eq(mcpTools.serverId, mcpServers.id))
    .where(and(eq(mcpTools.teamId, teamId), eq(mcpTools.toolId, input.toolId)))
    .limit(1);
  if (!tool) return { error: "tool_not_found" as const };
  try {
    const result = await withMcpClient(tool.server, (client) =>
      client.callTool({ name: tool.name, arguments: input.arguments ?? {} }),
    );
    return { ok: true as const, result };
  } catch (err) {
    return { error: "invoke_failed" as const, detail: errorMessage(err) };
  }
}

export async function liveToolGrants(teamId: string, agentId: string): Promise<ToolGrantRecord[]> {
  const [agent] = await db
    .select({ liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  if (!agent?.liveVersionId) return [];
  const [version] = await db
    .select({ grants: agentVersions.toolGrants, tools: agentVersions.tools })
    .from(agentVersions)
    .where(eq(agentVersions.id, agent.liveVersionId))
    .limit(1);
  if (!version) return [];
  if (version.grants.length > 0) return version.grants;
  return version.tools.map((toolId) => ({ toolId, scopes: ["read"] }));
}

export async function liveRuntimeTools(
  teamId: string,
  agentId: string,
): Promise<RuntimeToolDefinition[]> {
  const grants = await liveToolGrants(teamId, agentId);
  const mcpGrants = grants.filter((grant) => grant.toolId.startsWith("mcp:"));
  if (mcpGrants.length === 0) return [];
  const rows = await db
    .select({
      toolId: mcpTools.toolId,
      name: mcpTools.name,
      description: mcpTools.description,
      inputSchema: mcpTools.inputSchema,
      status: mcpTools.status,
    })
    .from(mcpTools)
    .where(and(eq(mcpTools.teamId, teamId), inToolIds(mcpGrants.map((g) => g.toolId))));
  const byId = new Map(rows.map((row) => [row.toolId, row]));
  return mcpGrants.flatMap((grant) => {
    const row = byId.get(grant.toolId);
    if (!row || row.status !== "available") return [];
    return [
      {
        toolId: grant.toolId,
        callName: callNameForToolId(grant.toolId),
        description: row.description || row.name,
        inputSchema: row.inputSchema,
        scopes: grant.scopes,
        requireApproval: grant.requireApproval,
      },
    ];
  });
}

function inToolIds(ids: string[]) {
  return ids.length === 1 ? eq(mcpTools.toolId, ids[0]!) : inArray(mcpTools.toolId, ids);
}
