import {
  approveRun,
  cancelRun,
  getAgentPlacementLabel,
  getRunDetail,
  listAgentRows,
  pauseRun,
  rejectRun,
  resumeRun,
} from "../../runs";
import { sendAgentChatTurn } from "../../chat/repo";
import { sendOrchestratedTurn } from "../../chat/orchestrator";
import {
  createProjectTask,
  getProject,
  listProjects,
  runProjectTask,
} from "../../projects/repo";
import { insertConfirmedMemory } from "../../learning/memory/service";
import type { TelegramCommand } from "./commands";
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
    case "freeChat": {
      const routed = await sendOrchestratedTurn({
        teamId: connection.teamId,
        surface: "telegram",
        actorId: identity.externalUserId,
        threadKey: `${connection.id}:${identity.externalChatId}:${identity.externalUserId}`,
        text: command.input,
        agentHintId: identity.activeAgentId,
      });
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
    case "status": {
      const detail = await getRunDetail(connection.teamId, command.runId);
      if (!detail)
        return { ok: false, reply: "Run not found.", runId: command.runId };
      const placement = "placement" in detail && detail.placement
        ? [
            detail.placement.runtimeKind,
            detail.placement.daemonName ?? detail.placement.daemonId ?? "any compatible computer",
            detail.placement.pinned ? "pinned" : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : null;
      return {
        ok: true,
        reply: `Run ${detail.run.id}\nStatus: ${detail.run.status}${placement ? `\nTarget: ${placement}` : ""}\nSteps: ${detail.run.completedSteps}/${detail.run.stepCount}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`,
        runId: command.runId,
      };
    }
    case "kill": {
      const ok = await cancelRun(connection.teamId, command.runId);
      return {
        ok,
        reply: ok
          ? `Run cancelled: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not cancellable.",
        runId: command.runId,
      };
    }
    case "pause": {
      const ok = await pauseRun(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run paused: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not pauseable.",
        runId: command.runId,
      };
    }
    case "resume": {
      const ok = await resumeRun(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run resumed: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not paused.",
        runId: command.runId,
      };
    }
    case "approve": {
      const ok = await approveRun(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run approved: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not waiting for approval.",
        runId: command.runId,
      };
    }
    case "reject": {
      const ok = await rejectRun(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run rejected: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not waiting for approval.",
        runId: command.runId,
      };
    }
    case "learn":
      if (!command.projectId)
        return {
          ok: false,
          reply: 'Usage: /learn project:<projectId> "confirmed project memory"',
        };
      if (!command.content)
        return {
          ok: false,
          reply: "Memory content is required.",
          projectId: command.projectId,
        };
      if (!(await getProject(connection.teamId, command.projectId))) {
        return {
          ok: false,
          reply: "Project not found.",
          projectId: command.projectId,
        };
      }
      await insertConfirmedMemory({
        teamId: connection.teamId,
        scope: "project",
        targetId: command.projectId,
        content: command.content,
        confidence: 1,
        createdBy: "user",
      });
      return {
        ok: true,
        reply: `Project memory saved\nProject: ${command.projectId}\n${command.content}`,
        projectId: command.projectId,
      };
    case "unknown":
      return {
        ok: false,
        reply: `Unknown command: ${command.text}\n\n${helpText(connection)}`,
      };
  }
}
