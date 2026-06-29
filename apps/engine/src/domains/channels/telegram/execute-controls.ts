import {
  approveRun,
  cancelRun,
  getRunDetail,
  pauseRun,
  rejectRun,
  resumeRun,
} from "../../runs";
import { processRun, simulateQueuedRuns } from "../../../jobs/run-simulator";
import { getProject } from "../../projects";
import { insertConfirmedMemory } from "../../learning/memory/service";
import { getActiveProjectId, setActiveProject } from "../repo";
import type { TelegramCommand } from "./commands";
import { helpText, webRunUrl } from "./helpers";
import {
  formatCommandError,
  formatRunControlReply,
  formatRunStatusReply,
} from "./presenter";
import type { ChannelConnectionRow, ChannelIdentityRow, TelegramDispatchResult } from "./types";

export async function executeRunControlCommand(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  command: TelegramCommand,
): Promise<TelegramDispatchResult | null> {
  switch (command.kind) {
    case "status": {
      if (!command.runId) return missingActiveRunReply();
      const detail = await getRunDetail(connection.teamId, command.runId);
      if (!detail)
        return {
          ok: false,
          reply: formatCommandError("Run introuvable."),
          runId: command.runId,
        };
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
        reply: formatRunStatusReply({
          id: detail.run.id,
          status: detail.run.status,
          completedSteps: detail.run.completedSteps,
          stepCount: detail.run.stepCount,
          placement,
          url: await webRunUrl(connection.teamId, command.runId),
        }),
        runId: command.runId,
      };
    }
    case "next": {
      if (command.runId) {
        const status = await processRun(connection.teamId, command.runId);
        return {
          ok: Boolean(status),
          reply: formatQueueAdvanceReply(
            status ? [{ runId: command.runId, status }] : [],
            command.runId,
          ),
          runId: command.runId,
        };
      }
      const result = await simulateQueuedRuns(connection.teamId);
      const last = [...result.processed].reverse().find((item) => item.status)?.runId;
      return {
        ok: result.processed.length > 0,
        reply: formatQueueAdvanceReply(result.processed),
        runId: last,
      };
    }
    case "kill": {
      if (!command.runId) return missingActiveRunReply();
      const ok = await cancelRun(connection.teamId, command.runId);
      return {
        ok,
        reply: formatRunControlReply("cancel", ok, {
          url: ok ? await webRunUrl(connection.teamId, command.runId) : undefined,
        }),
        runId: command.runId,
      };
    }
    case "pause": {
      if (!command.runId) return missingActiveRunReply();
      const ok = await pauseRun(connection.teamId, command.runId, command.reason);
      return {
        ok,
        reply: formatRunControlReply("pause", ok, {
          url: ok ? await webRunUrl(connection.teamId, command.runId) : undefined,
        }),
        runId: command.runId,
      };
    }
    case "resume": {
      if (!command.runId) return missingActiveRunReply();
      const ok = await resumeRun(connection.teamId, command.runId, command.reason);
      return {
        ok,
        reply: formatRunControlReply("resume", ok, {
          url: ok ? await webRunUrl(connection.teamId, command.runId) : undefined,
        }),
        runId: command.runId,
      };
    }
    case "approve": {
      if (!command.runId) return missingActiveRunReply();
      const ok = await approveRun(connection.teamId, command.runId, command.reason);
      return {
        ok,
        reply: formatRunControlReply("approve", ok, {
          url: ok ? await webRunUrl(connection.teamId, command.runId) : undefined,
        }),
        runId: command.runId,
      };
    }
    case "reject": {
      if (!command.runId) return missingActiveRunReply();
      const ok = await rejectRun(connection.teamId, command.runId, command.reason);
      return {
        ok,
        reply: formatRunControlReply("reject", ok, {
          url: ok ? await webRunUrl(connection.teamId, command.runId) : undefined,
        }),
        runId: command.runId,
      };
    }
    case "learn": {
      const projectId = command.projectId ?? (await getActiveProjectId(connection, identity));
      if (!projectId)
        return {
          ok: false,
          reply: formatCommandError(
            'Choisis un projet actif avec /project <projectId>, ou utilise /learn project:<projectId> "mémoire confirmée"',
          ),
        };
      if (!command.content)
        return {
          ok: false,
          reply: formatCommandError("Le contenu de mémoire est requis."),
          projectId,
        };
      if (!(await getProject(connection.teamId, projectId))) {
        if (!command.projectId) await setActiveProject(connection, identity, null);
        return {
          ok: false,
          reply: formatCommandError("Projet introuvable."),
          projectId,
        };
      }
      await setActiveProject(connection, identity, projectId);
      await insertConfirmedMemory({
        teamId: connection.teamId,
        scope: "project",
        targetId: projectId,
        content: command.content,
        confidence: 1,
        createdBy: "user",
      });
      return {
        ok: true,
        reply: [
          "Mémoire projet enregistrée.",
          `Projet : ${projectId}`,
          `Contenu : ${command.content}`,
        ].join("\n"),
        projectId,
      };
    }
    case "unknown":
      return {
        ok: false,
        reply: formatCommandError(`Commande inconnue : ${command.text}\n\n${helpText(connection)}`),
      };
    default:
      return null;
  }
}

function formatQueueAdvanceReply(
  processed: Array<{ runId: string; status: string | null }>,
  requestedRunId?: string,
) {
  if (!processed.length) {
    return requestedRunId
      ? `Je n'ai pas pu avancer ${requestedRunId}. Il est peut-être déjà traité ou introuvable.`
      : "Aucun run en queue à avancer.";
  }
  const lines = ["J'avance la file d'exécution."];
  for (const item of processed.slice(0, 8)) {
    lines.push(`- ${item.runId} -> ${item.status ?? "inchangé"}`);
  }
  if (processed.length > 8) lines.push(`... ${processed.length - 8} autres runs traités.`);
  if (processed.some((item) => item.status === "waiting_approval")) {
    lines.push("", "Accord requis : réponds /approve <runId> ok ou utilise le bouton Telegram.");
  }
  if (processed.some((item) => item.status === "succeeded")) {
    lines.push("", "Run terminé pour les éléments validés.");
  }
  return lines.join("\n");
}

function missingActiveRunReply(): TelegramDispatchResult {
  return {
    ok: false,
    reply: "Je n'ai pas de run actif pour ce chat. Relance avec un run explicite.",
  };
}
