import { jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { ts, type McpServerStatus, type McpToolStatus, type McpTransport } from "./_shared";
import { teams } from "./settings";

export const credentials = pgTable("credentials", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  /** AES-256-GCM blob (iv:tag:ciphertext, base64). Never returned by the API. */
  data: text("data").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: text("transport").$type<McpTransport>().notNull().default("streamable_http"),
    url: text("url").notNull(),
    credentialId: text("credential_id").references(() => credentials.id, { onDelete: "set null" }),
    status: text("status").$type<McpServerStatus>().notNull().default("unknown"),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("mcp_servers_team_name_unique").on(t.teamId, t.name)],
);

export const mcpTools = pgTable(
  "mcp_tools",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<McpToolStatus>().notNull().default("available"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("mcp_tools_team_tool_id_unique").on(t.teamId, t.toolId),
    unique("mcp_tools_server_name_unique").on(t.serverId, t.name),
  ],
);

