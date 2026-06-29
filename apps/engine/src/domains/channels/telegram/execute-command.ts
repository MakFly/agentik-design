import {
  getAgentPlacementLabel,
  getAgentCapabilities,
  listAgentRows,
} from "../../runs";
import { sendAgentChatTurn } from "../../chat/repo";
import { sendOrchestratedTurn } from "../../chat/orchestrator";
import {
  createProjectTask,
  getProject,
  listProjects,
  runProjectTask,
} from "../../projects";
import type { TelegramCommand } from "./commands";
import { executeRunControlCommand } from "./execute-controls";
import {
  activeAgentRow,
  agentHandle,
  clarifyAgentReply,
  helpText,
  resolveAgentHandle,
  runHelpText,
  webRunUrl,
} from "./helpers";
import {
  formatActiveAgentDisabledReply,
  formatActiveAgentReply,
  formatActiveProjectDisabledReply,
  formatActiveProjectReply,
  formatAgentUnavailableReply,
  formatAgentsReply,
  formatAgentSkillsReply,
  formatAgentNotFoundReply,
  formatAmbiguousAgentsReply,
  formatCommandError,
  formatCurrentAgentHelpReply,
  formatCurrentProjectHelpReply,
  formatOrchestrationStartedReply,
  formatProjectContextReply,
  formatProjectsReply,
  formatRunStartedReply,
  formatTasksReply,
} from "./presenter";
import { getActiveProjectId, setActiveAgent, setActiveProject } from "../repo";
import type { ChannelConnectionRow, ChannelIdentityRow, TelegramDispatchResult } from "./types";

type AgentListRow = Awaited<ReturnType<typeof listAgentRows>>[number];

async function sendTelegramAgentTurn(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  agent: Pick<AgentListRow, "id" | "name">,
  input: string,
) {
  return sendAgentChatTurn(connection.teamId, {
    agentId: agent.id,
    content: input,
    creatorId: `telegram:${identity.id}:agent:${agent.id}`,
    title: `Telegram · ${identity.displayName || identity.externalUserId} · ${agent.name}`,
  });
}

export async function executeCommand(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  command: TelegramCommand,
): Promise<TelegramDispatchResult> {
  switch (command.kind) {
    case "help":
      return { ok: true, reply: helpText(connection) };
    case "pair":
      return { ok: true, reply: "Ce chat est déjà connecté. Envoie /projects ou /agents pour commencer." };
    case "agents": {
      const agents = await listAgentRows(connection.teamId);
      return {
        ok: true,
        reply: formatAgentsReply(
          agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            handle: agentHandle(agent),
            health: agent.health,
            model: agent.model,
          })),
        ),
      };
    }
    case "skills": {
      let agentId = command.agentId;
      let resolvedAgent: AgentListRow | null = null;
      if (command.handle) {
        const resolved = await resolveAgentHandle(connection.teamId, command.handle);
        if ("error" in resolved) {
          return {
            ok: false,
            reply:
              resolved.error === "ambiguous"
                ? formatAmbiguousAgentsReply(
                    resolved.agents.map((agent) => ({
                      id: agent.id,
                      name: agent.name,
                      handle: agentHandle(agent),
                      health: agent.health,
                      model: agent.model,
                    })),
                  )
                : formatAgentNotFoundReply(command.handle),
          };
        }
        resolvedAgent = resolved.agent;
        agentId = resolved.agent.id;
      }
      if (!agentId) {
        resolvedAgent = await activeAgentRow(connection.teamId, identity);
        agentId = resolvedAgent?.id;
      }
      if (!agentId) {
        return {
          ok: false,
          reply: formatCommandError("Choisis un agent avec /agent @agent_handle ou utilise /skills @agent_handle."),
        };
      }
      const capabilities = await getAgentCapabilities(connection.teamId, agentId);
      if (!capabilities) return { ok: false, reply: formatAgentNotFoundReply(command.handle ?? agentId) };
      resolvedAgent ??= (await listAgentRows(connection.teamId)).find((agent) => agent.id === agentId) ?? null;
      return {
        ok: true,
        reply: formatAgentSkillsReply({
          id: capabilities.id,
          name: capabilities.name,
          handle: resolvedAgent ? agentHandle(resolvedAgent) : capabilities.id,
          role: capabilities.role,
          goal: capabilities.goal,
          health: capabilities.health,
          runtimeKind: capabilities.runtimeKind,
          model: capabilities.model,
          published: capabilities.published,
          version: capabilities.version,
          instructions: capabilities.instructions,
          tools: capabilities.tools,
          toolGrants: capabilities.toolGrants,
        }),
      };
    }
    case "projects": {
      const projects = await listProjects(connection.teamId);
      return {
        ok: true,
        reply: formatProjectsReply(
          projects.map((project) => ({
            id: project.id,
            name: project.name,
            openTaskCount: project.openTaskCount,
            type: project.type,
          })),
        ),
      };
    }
    case "projectMode": {
      if (command.off) {
        await setActiveProject(connection, identity, null);
        return {
          ok: true,
          reply: formatActiveProjectDisabledReply(),
        };
      }
      if (!command.projectId) {
        const activeProjectId = await getActiveProjectId(connection, identity);
        const project = activeProjectId
          ? await getProject(connection.teamId, activeProjectId)
          : null;
        if (activeProjectId && !project) {
          await setActiveProject(connection, identity, null);
        }
        return {
          ok: true,
          reply: formatCurrentProjectHelpReply(
            project
              ? { current: { id: project.project.id, name: project.project.name } }
              : { current: null },
          ),
          projectId: project?.project.id,
        };
      }
      const project = await getProject(connection.teamId, command.projectId);
      if (!project)
        return {
          ok: false,
          reply: formatCommandError("Projet introuvable. Utilise /projects pour voir les projets disponibles."),
          projectId: command.projectId,
        };
      await setActiveProject(connection, identity, project.project.id);
      return {
        ok: true,
        reply: formatActiveProjectReply({
          id: project.project.id,
          name: project.project.name,
        }),
        projectId: project.project.id,
      };
    }
    case "context": {
      const projectId = command.projectId ?? (await getActiveProjectId(connection, identity));
      if (!projectId)
        return {
          ok: false,
          reply: formatCommandError(
            "Choisis un projet actif avec /project <projectId>, ou utilise /context project:<projectId>.",
          ),
        };
      const project = await getProject(connection.teamId, projectId);
      if (!project) {
        if (!command.projectId) await setActiveProject(connection, identity, null);
        return {
          ok: false,
          reply: formatCommandError("Projet introuvable. Utilise /projects pour voir les projets disponibles."),
          projectId,
        };
      }
      await setActiveProject(connection, identity, project.project.id);
      return {
        ok: true,
        reply: formatProjectContextReply({
          project: {
            id: project.project.id,
            name: project.project.name,
            type: project.project.type,
            description: project.project.description,
          },
          tasks: project.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            priority: task.priority,
            status: task.status,
          })),
          resources: project.resources.map((resource) => ({
            type: resource.type,
            label: resource.label,
            ref: resource.ref,
          })),
          memories: project.memories.map((memory) => ({
            content: memory.content,
            confidence: memory.confidence,
          })),
        }),
        projectId: project.project.id,
      };
    }
    case "tasks": {
      const activeProjectId = command.projectId ?? (await getActiveProjectId(connection, identity));
      const projects = activeProjectId
        ? [await getProject(connection.teamId, activeProjectId)]
        : await Promise.all(
            (await listProjects(connection.teamId))
              .slice(0, 5)
              .map((project) => getProject(connection.teamId, project.id)),
          );
      if (activeProjectId && !projects[0]) {
        if (!command.projectId) await setActiveProject(connection, identity, null);
        return {
          ok: false,
          reply: formatCommandError(
            command.projectId
              ? "Projet introuvable. Utilise /projects pour voir les projets disponibles."
              : "Le projet actif est introuvable. Je l'ai retiré de ce chat.",
          ),
          projectId: activeProjectId,
        };
      }
      if (activeProjectId) await setActiveProject(connection, identity, activeProjectId);
      const tasks = projects
        .filter(Boolean)
        .flatMap((project) =>
          project!.tasks.map((task) => ({ project: project!.project, task })),
        )
        .filter(({ task }) => !["done", "cancelled"].includes(task.status))
        .slice(0, 10);
      return {
        ok: true,
        reply: formatTasksReply(
          tasks.map(({ project, task }) => ({
            id: task.id,
            title: task.title,
            priority: task.priority,
            status: task.status,
            projectName: project.name,
          })),
        ),
        projectId: activeProjectId ?? undefined,
      };
    }
    case "agentMode": {
      if (command.off) {
        await setActiveAgent(identity.id, null);
        return {
          ok: true,
          reply: formatActiveAgentDisabledReply(),
        };
      }
      if (!command.handle && !command.agentId) {
        const current = await activeAgentRow(connection.teamId, identity);
        return {
          ok: true,
          reply: await runHelpText(
            connection.teamId,
            formatCurrentAgentHelpReply(
              current
                ? { current: { handle: agentHandle(current), name: current.name } }
                : { current: null },
            ),
          ),
        };
      }
      let resolved: { agent: AgentListRow } | { error: "ambiguous" | "not_found"; agents: AgentListRow[] };
      if (command.agentId) {
        const agents = await listAgentRows(connection.teamId);
        const agent = agents.find((item) => item.id === command.agentId);
        resolved = agent ? { agent } : { error: "not_found", agents };
      } else {
        resolved = await resolveAgentHandle(connection.teamId, command.handle!);
      }
      if ("error" in resolved) {
        return {
          ok: false,
          reply:
            resolved.error === "ambiguous"
              ? formatAmbiguousAgentsReply(
                  resolved.agents.map((agent) => ({
                    id: agent.id,
                    name: agent.name,
                    handle: agentHandle(agent),
                    health: agent.health,
                    model: agent.model,
                  })),
                )
              : formatAgentNotFoundReply(command.handle),
        };
      }
      if (!resolved.agent.liveVersionId) {
        return {
          ok: false,
          reply: formatAgentUnavailableReply(
            `${resolved.agent.name} n'est pas encore publié.`,
          ),
        };
      }
      await setActiveAgent(identity.id, resolved.agent.id);
      return {
        ok: true,
        reply: formatActiveAgentReply({
          handle: agentHandle(resolved.agent),
          name: resolved.agent.name,
        }),
      };
    }
    case "run": {
      if (!command.title)
        return {
          ok: false,
          reply: formatCommandError('Format attendu : /run "titre de tâche" après /project <projectId>.'),
        };
      const projectId = command.projectId ?? (await getActiveProjectId(connection, identity));
      if (!projectId)
        return {
          ok: false,
          reply: formatCommandError(
            'Choisis un projet actif avec /project <projectId>, ou utilise /run project:<projectId> "titre de tâche".',
          ),
        };
      const task = await createProjectTask(
        connection.teamId,
        projectId,
        `telegram:${identity.externalUserId}`,
        {
          title: command.title,
          assignedAgentId: command.agentId ?? identity.activeAgentId ?? null,
          status: "ready",
        },
      );
      if ("error" in task)
        return {
          ok: false,
          reply: formatCommandError(`Création de tâche impossible : ${task.error}`),
          projectId,
        };
      const projectTask = task.task;
      if (!projectTask)
        return {
          ok: false,
          reply: formatCommandError("Création de tâche impossible."),
          projectId,
        };
      const run = await runProjectTask(
        connection.teamId,
        projectTask.id,
        "Started from Telegram.",
      );
      if ("error" in run) {
        return {
          ok: false,
          reply: formatCommandError(
            `La tâche est créée (${projectTask.id}), mais le run n'a pas démarré : ${run.error}`,
          ),
          projectId,
          projectTaskId: projectTask.id,
        };
      }
      await setActiveProject(connection, identity, projectId);
      return {
        ok: true,
        reply: formatRunStartedReply({
          title: projectTask.title,
          url: await webRunUrl(connection.teamId, run.runId),
        }),
        runId: run.runId,
        projectId,
        projectTaskId: projectTask.id,
      };
    }
    case "runAgent": {
      if (!command.input)
        return {
          ok: false,
          reply: formatCommandError('Format attendu : /run agent:<agentId> "demande"'),
        };
      const agents = await listAgentRows(connection.teamId);
      const agent = agents.find((item) => item.id === command.agentId);
      if (!agent) return { ok: false, reply: formatAgentNotFoundReply(command.agentId) };
      const run = await sendTelegramAgentTurn(connection, identity, agent, command.input);
      if ("error" in run)
        return {
          ok: false,
          reply: formatAgentUnavailableReply(run.error),
        };
      await setActiveAgent(identity.id, command.agentId);
      const placement = await getAgentPlacementLabel(connection.teamId, command.agentId);
      return {
        ok: true,
        reply: formatRunStartedReply({
          agentName: agent?.name ?? command.agentId,
          placement,
          url: await webRunUrl(connection.teamId, run.runId),
        }),
        runId: run.runId,
      };
    }
    case "runAgentHandle": {
      if (!command.input)
        return {
          ok: false,
          reply: formatCommandError('Format attendu : /run @agent_handle "demande"'),
        };
      const resolved = await resolveAgentHandle(connection.teamId, command.handle);
      if ("error" in resolved) {
        if (resolved.error === "ambiguous") {
          return {
            ok: false,
            reply: formatAmbiguousAgentsReply(
              resolved.agents.map((agent) => ({
                id: agent.id,
                name: agent.name,
                handle: agentHandle(agent),
                health: agent.health,
                model: agent.model,
              })),
            ),
          };
        }
        return {
          ok: false,
          reply: formatAgentNotFoundReply(command.handle),
        };
      }
      const run = await sendTelegramAgentTurn(connection, identity, resolved.agent, command.input);
      if ("error" in run)
        return {
          ok: false,
          reply: formatAgentUnavailableReply(run.error),
        };
      await setActiveAgent(identity.id, resolved.agent.id);
      const placement = await getAgentPlacementLabel(connection.teamId, resolved.agent.id);
      return {
        ok: true,
        reply: formatRunStartedReply({
          agentName: resolved.agent.name,
          placement,
          url: await webRunUrl(connection.teamId, run.runId),
        }),
        runId: run.runId,
      };
    }
    case "orchestrate": {
      if (!command.input)
        return {
          ok: false,
          reply: formatCommandError('Format attendu : /orchestrate "première étape puis deuxième étape"'),
        };
      const routed = await sendOrchestratedTurn({
        teamId: connection.teamId,
        surface: "telegram",
        actorId: identity.externalUserId,
        threadKey: `${connection.id}:${identity.externalChatId}:${identity.externalUserId}`,
        text: command.input,
        agentHintId: identity.activeAgentId,
        forceOrchestration: true,
      });
      if (routed.kind === "orchestration") {
        return {
          ok: true,
          reply: formatOrchestrationStartedReply({
            steps: routed.plan.steps.length,
            childRunId: routed.childRunId,
            url: await webRunUrl(connection.teamId, routed.runId),
          }),
          runId: routed.runId,
        };
      }
      if (routed.kind === "run") {
        const placement = await getAgentPlacementLabel(connection.teamId, routed.agent.id);
        return {
          ok: true,
          reply: formatRunStartedReply({
            agentName: routed.agent.name,
            placement,
            url: await webRunUrl(connection.teamId, routed.runId),
          }),
          runId: routed.runId,
        };
      }
      if (routed.kind === "clarify") {
        return { ok: true, reply: clarifyAgentReply(routed.question, routed.choices) };
      }
      return { ok: false, reply: formatCommandError("Orchestration impossible.") };
    }
    case "freeChat": {
      const routed = await sendOrchestratedTurn({
        teamId: connection.teamId,
        surface: "telegram",
        actorId: identity.externalUserId,
        threadKey: `${connection.id}:${identity.externalChatId}:${identity.externalUserId}`,
        text: command.input,
        agentHintId: identity.activeAgentId,
      });
      if (routed.kind === "orchestration") {
        return {
          ok: true,
          reply: formatOrchestrationStartedReply({
            steps: routed.plan.steps.length,
            childRunId: routed.childRunId,
            url: await webRunUrl(connection.teamId, routed.runId),
          }),
          runId: routed.runId,
        };
      }
      if (routed.kind === "run") {
        await setActiveAgent(identity.id, routed.agent.id);
        // A built-in skill already ran the work and delivered the result via
        // onRunCompleted (Telegram notify). A second "work started" ack here
        // would be a misleading, out-of-order duplicate — stay silent.
        if (routed.completed) {
          return { ok: true, runId: routed.runId, reply: "" };
        }
        const placement = await getAgentPlacementLabel(connection.teamId, routed.agent.id);
        return {
          ok: true,
          reply: formatRunStartedReply({
            agentName: routed.agent.name,
            placement,
            url: await webRunUrl(connection.teamId, routed.runId),
          }),
          runId: routed.runId,
        };
      }
      if (routed.kind === "clarify") {
        return { ok: true, reply: clarifyAgentReply(routed.question, routed.choices) };
      }
      return {
        ok: false,
        reply: formatAgentUnavailableReply(
          routed.error === "no_published_agents"
            ? "aucun agent publié n'est disponible"
            : routed.error === "no_live_daemon"
              ? "aucun daemon n'est en ligne pour le runtime de cet agent"
              : "routage impossible pour ce message",
        ),
      };
    }
    case "runTask": {
      const run = await runProjectTask(
        connection.teamId,
        command.taskId,
        command.instruction,
      );
      if ("error" in run) {
        return {
          ok: false,
          reply: formatCommandError(
            `Je n'ai pas pu lancer cette tâche : ${run.error}. Utilise /tasks pour voir les tâches ouvertes.`,
          ),
          projectTaskId: command.taskId,
        };
      }
      return {
        ok: true,
        reply: formatRunStartedReply({
          title: command.taskId,
          url: await webRunUrl(connection.teamId, run.runId),
        }),
        runId: run.runId,
        projectTaskId: command.taskId,
      };
    }
    case "runHelp":
      return {
        ok: true,
        reply: await runHelpText(
          connection.teamId,
          command.text
            ? "Je n'ai pas reconnu cette commande de run. Utilise un des chemins rapides ci-dessous."
            : undefined,
        ),
      };
    default: {
      const control = await executeRunControlCommand(connection, identity, command);
      if (control) return control;
      return {
        ok: false,
        reply: formatCommandError(`Commande inconnue.\n\n${helpText(connection)}`),
      };
    }
  }
}
