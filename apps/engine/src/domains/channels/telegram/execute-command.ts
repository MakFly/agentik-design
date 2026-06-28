import {
  getAgentPlacementLabel,
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
  startRunReply,
  webRunUrl,
} from "./helpers";
import { setActiveAgent } from "../repo";
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
      return { ok: true, reply: "This chat is already paired." };
    case "agents": {
      const agents = await listAgentRows(connection.teamId);
      if (!agents.length) return { ok: true, reply: "No agents yet." };
      return {
        ok: true,
        reply: agents
          .slice(0, 10)
          .map(
            (agent) =>
              `${agent.name}\n@${agentHandle(agent)} · ${agent.id} · ${agent.health} · ${agent.model}`,
          )
          .join("\n\n"),
      };
    }
    case "projects": {
      const projects = await listProjects(connection.teamId);
      if (!projects.length) return { ok: true, reply: "No projects yet." };
      return {
        ok: true,
        reply: projects
          .slice(0, 8)
          .map(
            (project) =>
              `${project.name}\n${project.id} · ${project.openTaskCount} open · ${project.type}`,
          )
          .join("\n\n"),
      };
    }
    case "tasks": {
      const projects = command.projectId
        ? [await getProject(connection.teamId, command.projectId)]
        : await Promise.all(
            (await listProjects(connection.teamId))
              .slice(0, 5)
              .map((project) => getProject(connection.teamId, project.id)),
          );
      const tasks = projects
        .filter(Boolean)
        .flatMap((project) =>
          project!.tasks.map((task) => ({ project: project!.project, task })),
        )
        .filter(({ task }) => !["done", "cancelled"].includes(task.status))
        .slice(0, 10);
      if (!tasks.length) return { ok: true, reply: "No open tasks." };
      return {
        ok: true,
        reply: tasks
          .map(
            ({ project, task }) =>
              `${task.priority} ${task.title}\n${project.name} · ${task.status} · ${task.id}`,
          )
          .join("\n\n"),
      };
    }
    case "agentMode": {
      if (command.off) {
        await setActiveAgent(identity.id, null);
        return {
          ok: true,
          reply: "Agent mode disabled. Use /agent @agent_handle to pick one again.",
        };
      }
      if (!command.handle && !command.agentId) {
        const current = await activeAgentRow(connection.teamId, identity);
        return {
          ok: true,
          reply: await runHelpText(
            connection.teamId,
            current
              ? `Current agent: @${agentHandle(current)} (${current.name}).`
              : "No active agent for this chat yet.",
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
              ? [
                  "Several agents match. Use one id explicitly:",
                  ...resolved.agents.map((agent) => `${agent.name} · ${agent.id}`),
                ].join("\n")
              : "Agent not found. Use /agents to list available handles.",
        };
      }
      if (!resolved.agent.liveVersionId) {
        return {
          ok: false,
          reply: `${resolved.agent.name} is not published yet. Publish it before using it from Telegram.`,
        };
      }
      await setActiveAgent(identity.id, resolved.agent.id);
      return {
        ok: true,
        reply: `Agent mode enabled: @${agentHandle(resolved.agent)} (${resolved.agent.name}).\nNow send messages directly, without /run.`,
      };
    }
    case "run": {
      if (!command.title)
        return {
          ok: false,
          reply: 'Usage: /run project:<projectId> "Task title"',
        };
      const task = await createProjectTask(
        connection.teamId,
        command.projectId,
        `telegram:${identity.externalUserId}`,
        {
          title: command.title,
          assignedAgentId: command.agentId ?? null,
          status: "ready",
        },
      );
      if ("error" in task)
        return {
          ok: false,
          reply: `Could not create task: ${task.error}`,
          projectId: command.projectId,
        };
      const projectTask = task.task;
      if (!projectTask)
        return {
          ok: false,
          reply: "Could not create task.",
          projectId: command.projectId,
        };
      const run = await runProjectTask(
        connection.teamId,
        projectTask.id,
        "Started from Telegram.",
      );
      if ("error" in run) {
        return {
          ok: false,
          reply: `Task created, but run did not start: ${projectTask.id}\nReason: ${run.error}`,
          projectId: command.projectId,
          projectTaskId: projectTask.id,
        };
      }
      return {
        ok: true,
        reply: `Run started\nTask: ${projectTask.title}\nRun: ${run.runId}\nOpen: ${await webRunUrl(connection.teamId, run.runId)}`,
        runId: run.runId,
        projectId: command.projectId,
        projectTaskId: projectTask.id,
      };
    }
    case "runAgent": {
      if (!command.input)
        return {
          ok: false,
          reply: 'Usage: /run agent:<agentId> "what should the agent do?"',
        };
      const agents = await listAgentRows(connection.teamId);
      const agent = agents.find((item) => item.id === command.agentId);
      if (!agent) return { ok: false, reply: "Agent not found." };
      const run = await sendTelegramAgentTurn(connection, identity, agent, command.input);
      if ("error" in run)
        return {
          ok: false,
          reply:
            run.error === "not_published"
              ? "This agent is not published yet."
              : run.error === "no_live_daemon"
                ? "❌ No daemon is online for this agent's runtime. Start your daemon, then try again."
              : run.error === "empty_input"
                ? 'Usage: /run agent:<agentId> "what should the agent do?"'
              : `Could not start agent: ${run.error}`,
        };
      await setActiveAgent(identity.id, command.agentId);
      const placement = await getAgentPlacementLabel(connection.teamId, command.agentId);
      return {
        ok: true,
        reply: startRunReply(agent?.name ?? command.agentId, placement, await webRunUrl(connection.teamId, run.runId)),
        runId: run.runId,
      };
    }
    case "runAgentHandle": {
      if (!command.input)
        return {
          ok: false,
          reply: 'Usage: /run @agent_handle "what should the agent do?"',
        };
      const resolved = await resolveAgentHandle(connection.teamId, command.handle);
      if ("error" in resolved) {
        if (resolved.error === "ambiguous") {
          return {
            ok: false,
            reply: [
              `Several agents match @${command.handle}. Use one id explicitly:`,
              ...resolved.agents.map((agent) => `${agent.name} · ${agent.id}`),
            ].join("\n"),
          };
        }
        return {
          ok: false,
          reply: `No agent found for @${command.handle}.\nUse /agents to list available handles.`,
        };
      }
      const run = await sendTelegramAgentTurn(connection, identity, resolved.agent, command.input);
      if ("error" in run)
        return {
          ok: false,
          reply:
            run.error === "not_published"
              ? "This agent is not published yet."
              : run.error === "no_live_daemon"
                ? "❌ No daemon is online for this agent's runtime. Start your daemon, then try again."
              : run.error === "empty_input"
                ? 'Usage: /run @agent_handle "what should the agent do?"'
              : `Could not start agent: ${run.error}`,
        };
      await setActiveAgent(identity.id, resolved.agent.id);
      const placement = await getAgentPlacementLabel(connection.teamId, resolved.agent.id);
      return {
        ok: true,
        reply: startRunReply(resolved.agent.name, placement, await webRunUrl(connection.teamId, run.runId)),
        runId: run.runId,
      };
    }
    case "orchestrate": {
      if (!command.input)
        return {
          ok: false,
          reply: 'Usage: /orchestrate "first step puis second step"',
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
          reply: [
            `Orchestration started (${routed.plan.steps.length} steps)`,
            routed.childRunId ? `Active child: ${routed.childRunId}` : null,
            `Open: ${await webRunUrl(connection.teamId, routed.runId)}`,
          ]
            .filter(Boolean)
            .join("\n"),
          runId: routed.runId,
        };
      }
      if (routed.kind === "run") {
        const placement = await getAgentPlacementLabel(connection.teamId, routed.agent.id);
        return {
          ok: true,
          reply: startRunReply(routed.agent.name, placement, await webRunUrl(connection.teamId, routed.runId)),
          runId: routed.runId,
        };
      }
      if (routed.kind === "clarify") {
        return { ok: true, reply: clarifyAgentReply(routed.question, routed.choices) };
      }
      return { ok: false, reply: "Could not start an orchestration." };
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
          reply: [
            `Orchestration started (${routed.plan.steps.length} steps)`,
            routed.childRunId ? `Active child: ${routed.childRunId}` : null,
            `Open: ${await webRunUrl(connection.teamId, routed.runId)}`,
          ]
            .filter(Boolean)
            .join("\n"),
          runId: routed.runId,
        };
      }
      if (routed.kind === "run") {
        await setActiveAgent(identity.id, routed.agent.id);
        const placement = await getAgentPlacementLabel(connection.teamId, routed.agent.id);
        return {
          ok: true,
          reply: startRunReply(routed.agent.name, placement, await webRunUrl(connection.teamId, routed.runId)),
          runId: routed.runId,
        };
      }
      if (routed.kind === "clarify") {
        return { ok: true, reply: clarifyAgentReply(routed.question, routed.choices) };
      }
      return {
        ok: false,
        reply:
          routed.error === "no_published_agents"
            ? "No published agent is available yet."
            : routed.error === "no_live_daemon"
              ? "❌ No daemon is online for this agent's runtime. Start your daemon, then try again."
              : "Could not start an agent for this message.",
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
          reply: `Could not start task: ${run.error}\nUse /tasks to list open task ids.`,
          projectTaskId: command.taskId,
        };
      }
      return {
        ok: true,
        reply: `Task run started\nTask: ${command.taskId}\nRun: ${run.runId}\nOpen: ${await webRunUrl(connection.teamId, run.runId)}`,
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
            ? "I do not run free-form chat yet. Use one of these explicit commands."
            : undefined,
        ),
      };
    default: {
      const control = await executeRunControlCommand(connection, identity, command);
      if (control) return control;
      return {
        ok: false,
        reply: `Unknown command\n\n${helpText(connection)}`,
      };
    }
  }
}
