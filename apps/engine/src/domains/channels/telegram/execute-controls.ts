import {
  approveRun,
  cancelRun,
  getRunDetail,
  pauseRun,
  rejectRun,
  resumeRun,
} from "../../runs";
import { getProject } from "../../projects/repo";
import { insertConfirmedMemory } from "../../learning/memory/service";
import type { TelegramCommand } from "./commands";
import { helpText, webRunUrl } from "./helpers";
import type { ChannelConnectionRow, ChannelIdentityRow, TelegramDispatchResult } from "./types";

export async function executeRunControlCommand(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  command: TelegramCommand,
): Promise<TelegramDispatchResult | null> {
  switch (command.kind) {
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
      const ok = await pauseRun(connection.teamId, command.runId, command.reason);
      return {
        ok,
        reply: ok
          ? `Run paused: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not pauseable.",
        runId: command.runId,
      };
    }
    case "resume": {
      const ok = await resumeRun(connection.teamId, command.runId, command.reason);
      return {
        ok,
        reply: ok
          ? `Run resumed: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not paused.",
        runId: command.runId,
      };
    }
    case "approve": {
      const ok = await approveRun(connection.teamId, command.runId, command.reason);
      return {
        ok,
        reply: ok
          ? `Run approved: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not waiting for approval.",
        runId: command.runId,
      };
    }
    case "reject": {
      const ok = await rejectRun(connection.teamId, command.runId, command.reason);
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
    default:
      return null;
  }
}
