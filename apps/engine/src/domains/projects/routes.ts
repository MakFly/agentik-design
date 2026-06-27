import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import {
  addProjectResource,
  addProjectTaskComment,
  createProject,
  createProjectTask,
  getProject,
  listProjectTaskComments,
  listProjects,
  runProjectTask,
  updateProjectTask,
} from "./repo";

export const projectsRoutes = new Hono<{ Variables: AuthVars }>();

projectsRoutes.get("/projects", requirePermission("run:read"), async (c) => {
  const items = await listProjects(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

projectsRoutes.post("/projects", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    type?: unknown;
    description?: string;
    leadAgentId?: string | null;
  };
  const res = await createProject(c.get("teamId"), c.get("auth").userId, body);
  if ("error" in res) return c.json({ error: res.error }, 400);
  return c.json(res.project, 201);
});

projectsRoutes.get("/projects/:id", requirePermission("run:read"), async (c) => {
  const res = await getProject(c.get("teamId"), c.req.param("id"));
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res);
});

projectsRoutes.post("/projects/:id/resources", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: unknown;
    ref?: string;
    label?: string;
    meta?: Record<string, unknown>;
  };
  const res = await addProjectResource(c.get("teamId"), c.req.param("id"), body);
  if ("error" in res)
    return c.json({ error: res.error }, res.error === "project_not_found" ? 404 : 400);
  return c.json(res.resource, 201);
});

projectsRoutes.post("/projects/:id/tasks", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    priority?: unknown;
    assignedAgentId?: string | null;
    status?: unknown;
  };
  const res = await createProjectTask(
    c.get("teamId"),
    c.req.param("id"),
    c.get("auth").userId,
    body,
  );
  if ("error" in res)
    return c.json({ error: res.error }, res.error === "project_not_found" ? 404 : 400);
  return c.json(res.task, 201);
});

projectsRoutes.patch("/project-tasks/:id", requirePermission("run:control"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: unknown;
    assignedAgentId?: string | null;
    title?: string;
    description?: string;
    priority?: unknown;
  };
  const task = await updateProjectTask(c.get("teamId"), c.req.param("id"), body);
  if (!task) return c.json({ error: "not_found" }, 404);
  return c.json(task);
});

projectsRoutes.get(
  "/project-tasks/:id/comments",
  requirePermission("run:read"),
  async (c) => {
    const items = await listProjectTaskComments(c.get("teamId"), c.req.param("id"));
    return c.json({ items, total: items.length });
  },
);

projectsRoutes.post(
  "/project-tasks/:id/comments",
  requirePermission("run:run"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { content?: string };
    const res = await addProjectTaskComment(
      c.get("teamId"),
      c.req.param("id"),
      c.get("auth").userId,
      body.content ?? "",
    );
    if ("error" in res)
      return c.json({ error: res.error }, res.error === "task_not_found" ? 404 : 400);
    return c.json(res.comment, 201);
  },
);

projectsRoutes.post("/project-tasks/:id/run", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { instruction?: string };
  const res = await runProjectTask(c.get("teamId"), c.req.param("id"), body.instruction);
  if ("error" in res) {
    const error = res.error ?? "unknown_error";
    const status =
      error.endsWith("_not_found") || error === "task_not_found" ? 404 : 409;
    return c.json({ error }, status);
  }
  return c.json(res, 202);
});
