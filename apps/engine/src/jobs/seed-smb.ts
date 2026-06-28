/**
 * Seed a believable SMB tenant doing daily email work, exercising the WHOLE
 * data-model loop: orchestrator + roster, a project with resources/tasks, signals
 * with REAL conditions + a webhook token, a Telegram channel binding/identity, and
 * queued runs that the local simulator drives to completion (real mailpit email +
 * approval gating + Telegram delivery).
 *
 * Idempotent: structural rows are found-or-created by name; demo runs are (re)queued
 * on every call so the loop can be replayed. In dev, "Gmail" is infra-mailpit.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../infra/db/client";
import { genId } from "../infra/db/ids";
import { createAgent, setRoster } from "../domains/agents/repo";
import { publishAgent } from "../domains/runs/service";
import { addProjectResource, createProject, createProjectTask } from "../domains/projects";
import { createRule, createSignal } from "../domains/signals/repo";

const {
  agents,
  projects,
  projectTasks,
  signals,
  channelConnections,
  channelBindings,
  channelIdentities,
  runs,
} = schema;

const OPERATOR_EMAIL = process.env.SEED_OPERATOR_EMAIL ?? "kev.aubree@gmail.com";

interface AgentDef {
  name: string;
  role: string;
  goal: string;
  emoji: string;
  color: string;
  isOrchestrator?: boolean;
  systemPrompt: string;
  sendTool?: boolean;
}

const AGENTS: AgentDef[] = [
  {
    name: "Office Manager",
    role: "orchestrator",
    goal: "Route daily office work to the right specialist and report back.",
    emoji: "🧭",
    color: "#6366f1",
    isOrchestrator: true,
    systemPrompt: "You are the office manager. Delegate to Inbox Triage, Billing Chaser and Scheduler.",
  },
  {
    name: "Inbox Triage",
    role: "operator",
    goal: "Classify the inbox into respond / archive / escalate and draft replies.",
    emoji: "📥",
    color: "#0ea5e9",
    systemPrompt: "Triage incoming email. Draft replies but never send without approval.",
    sendTool: true,
  },
  {
    name: "Billing Chaser",
    role: "operator",
    goal: "Find overdue invoices and draft polite payment reminders.",
    emoji: "🧾",
    color: "#f59e0b",
    systemPrompt: "Chase overdue invoices. Draft reminders; sending requires operator approval.",
    sendTool: true,
  },
  {
    name: "Scheduler",
    role: "operator",
    goal: "Propose meeting slots and draft calendar invites.",
    emoji: "📅",
    color: "#10b981",
    systemPrompt: "Schedule meetings. Propose slots and draft invites; sending requires approval.",
    sendTool: true,
  },
];

function agentConfig(def: AgentDef) {
  return {
    systemPrompt: def.systemPrompt,
    runtimeKind: "echo",
    tools: def.sendTool
      ? [{ toolId: "gmail.send", scopes: ["send"], requireApproval: true, rateCapPerMin: 5 }]
      : [],
  };
}

async function ensureAgent(teamId: string, def: AgentDef): Promise<string> {
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.name, def.name)))
    .limit(1);
  let id = existing?.id;
  if (!id) {
    const created = await createAgent(teamId, {
      name: def.name,
      role: def.role,
      goal: def.goal,
      emoji: def.emoji,
      color: def.color,
      isOrchestrator: def.isOrchestrator ?? false,
    });
    id = created.id;
  }
  await publishAgent(teamId, id, agentConfig(def), "seed", {
    name: def.name,
    role: def.role,
    goal: def.goal,
    emoji: def.emoji,
    color: def.color,
    isOrchestrator: def.isOrchestrator ?? false,
  });
  return id;
}

async function ensureProject(teamId: string, createdBy: string, leadAgentId: string) {
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.teamId, teamId), eq(projects.name, "Daily Office Ops")))
    .limit(1);
  if (existing) return existing.id;
  const res = await createProject(teamId, createdBy, {
    name: "Daily Office Ops",
    type: "ops",
    description: "Daily inbox triage, invoice follow-ups and meeting scheduling for the SMB.",
    leadAgentId,
  });
  if ("error" in res) throw new Error(`seed project failed: ${res.error}`);
  return res.project.id;
}

async function ensureTask(
  teamId: string,
  projectId: string,
  createdBy: string,
  title: string,
  agentId: string,
  priority: "P1" | "P2",
): Promise<string> {
  const [existing] = await db
    .select({ id: projectTasks.id })
    .from(projectTasks)
    .where(and(eq(projectTasks.teamId, teamId), eq(projectTasks.projectId, projectId), eq(projectTasks.title, title)))
    .limit(1);
  if (existing) return existing.id;
  const res = await createProjectTask(teamId, projectId, createdBy, {
    title,
    priority,
    assignedAgentId: agentId,
    status: "ready",
  });
  if ("error" in res) throw new Error(`seed task failed: ${res.error}`);
  if (!res.task) throw new Error("seed task failed: no row");
  return res.task.id;
}

async function ensureTelegram(teamId: string, createdBy: string, officeManagerId: string) {
  const [existing] = await db
    .select()
    .from(channelConnections)
    .where(and(eq(channelConnections.teamId, teamId), eq(channelConnections.label, "SMB Ops Bot")))
    .limit(1);
  let connectionId = existing?.id;
  if (!connectionId) {
    connectionId = genId("chan");
    await db.insert(channelConnections).values({
      id: connectionId,
      teamId,
      provider: "telegram",
      label: "SMB Ops Bot",
      status: "active",
      botUsername: "agentik_smb_demo_bot",
      webhookSecret: genId("chan").replace("chan_", ""),
      pairingCode: genId("chan").slice(-8).toUpperCase(),
      createdBy,
    });
  }
  // Binding: route this bot to the Office Manager.
  const [binding] = await db
    .select({ id: channelBindings.id })
    .from(channelBindings)
    .where(and(eq(channelBindings.teamId, teamId), eq(channelBindings.connectionId, connectionId)))
    .limit(1);
  if (!binding) {
    await db.insert(channelBindings).values({
      id: genId("chbind"),
      teamId,
      connectionId,
      agentId: officeManagerId,
      groupPolicy: "open",
      requireMention: true,
      status: "active",
    });
  }
  // Operator identity (the human who approves from Telegram).
  const [identity] = await db
    .select({ id: channelIdentities.id })
    .from(channelIdentities)
    .where(and(eq(channelIdentities.teamId, teamId), eq(channelIdentities.connectionId, connectionId)))
    .limit(1);
  let identityId = identity?.id;
  if (!identityId) {
    identityId = genId("chident");
    await db.insert(channelIdentities).values({
      id: identityId,
      teamId,
      connectionId,
      externalUserId: "tg-operator-1",
      externalChatId: "900900900",
      displayName: "SMB Operator",
      role: "operator",
    });
  }
  return { connectionId, identityId, chatId: "900900900" };
}

async function ensureSignalWithRule(
  teamId: string,
  def: {
    name: string;
    kind: string;
    source: string;
    config: Record<string, unknown>;
    rule: { name: string; condition: Record<string, unknown>; targetAgentId: string; input: string };
  },
) {
  const [existing] = await db
    .select({ id: signals.id })
    .from(signals)
    .where(and(eq(signals.teamId, teamId), eq(signals.name, def.name)))
    .limit(1);
  let signalId = existing?.id;
  if (!signalId) {
    const sig = await createSignal(teamId, {
      name: def.name,
      kind: def.kind,
      source: def.source,
      status: "active",
      config: def.config,
    });
    signalId = sig.id;
    await createRule(teamId, {
      name: def.rule.name,
      status: "active",
      signalId,
      targetAgentId: def.rule.targetAgentId,
      condition: def.rule.condition,
      action: { type: "run_agent", input: def.rule.input },
    });
  }
  return signalId;
}

/** Queue a fresh simulated run for a project task (the simulator will drive it). */
async function queueDemoRun(
  teamId: string,
  agentId: string,
  projectId: string,
  taskId: string,
  simulate: Record<string, unknown>,
  prompt: string,
): Promise<string> {
  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId,
    executor: "daemon",
    agentId,
    projectId,
    projectTaskId: taskId,
    status: "queued",
    kind: "chat",
    input: { prompt, simulate },
  });
  await db
    .update(projectTasks)
    .set({ status: "running", lastRunId: runId })
    .where(eq(projectTasks.id, taskId));
  return runId;
}

export interface SeedResult {
  teamId: string;
  agents: Record<string, string>;
  projectId: string;
  taskIds: string[];
  signalIds: string[];
  channel: { connectionId: string; identityId: string; chatId: string };
  runIds: string[];
  gmailWebhookToken: string;
}

export async function seedSmbTenant(teamId: string, createdBy: string): Promise<SeedResult> {
  // 1) Agents + roster.
  const agentIds: Record<string, string> = {};
  for (const def of AGENTS) agentIds[def.name] = await ensureAgent(teamId, def);
  await setRoster(teamId, agentIds["Office Manager"]!, [
    { agentId: agentIds["Inbox Triage"]!, instruction: "Triage and draft replies." },
    { agentId: agentIds["Billing Chaser"]!, instruction: "Chase overdue invoices." },
    { agentId: agentIds["Scheduler"]!, instruction: "Schedule meetings." },
  ]);

  // 2) Project + resources + tasks.
  const projectId = await ensureProject(teamId, createdBy, agentIds["Office Manager"]!);
  await addProjectResource(teamId, projectId, {
    type: "url",
    ref: process.env.MAILPIT_API ?? "http://localhost:8025",
    label: `Gmail mailbox (${OPERATOR_EMAIL}) — Mailpit in dev`,
  });
  await addProjectResource(teamId, projectId, {
    type: "document",
    ref: "invoices/overdue.csv",
    label: "Overdue invoices sheet",
  });
  const triageTaskId = await ensureTask(teamId, projectId, createdBy, "Triage today's inbox", agentIds["Inbox Triage"]!, "P1");
  const invoiceTaskId = await ensureTask(teamId, projectId, createdBy, "Chase overdue invoice #42", agentIds["Billing Chaser"]!, "P1");
  const meetingTaskId = await ensureTask(teamId, projectId, createdBy, "Schedule the Acme kickoff", agentIds["Scheduler"]!, "P2");

  // 3) Telegram channel (binding + operator identity for approvals).
  const channel = await ensureTelegram(teamId, createdBy, agentIds["Office Manager"]!);

  // 4) Signals + rules with REAL conditions.
  const gmailWebhookToken = genId("sig").replace("sig_", "wht_");
  const signalIds = [
    await ensureSignalWithRule(teamId, {
      name: "Gmail — new message",
      kind: "webhook",
      source: "gmail",
      config: { webhookToken: gmailWebhookToken, mailbox: OPERATOR_EMAIL },
      rule: {
        name: "Invoice emails → Billing Chaser",
        condition: { any: [{ path: "label", equals: "invoice" }, { path: "subject", contains: "invoice" }] },
        targetAgentId: agentIds["Billing Chaser"]!,
        input: "Chase the overdue invoice referenced in this email.",
      },
    }),
    await ensureSignalWithRule(teamId, {
      name: "Invoice follow-up — weekday 09:00",
      kind: "schedule",
      source: "cron",
      config: { cron: "0 9 * * 1-5", tz: "Europe/Paris" },
      rule: {
        name: "Daily invoice sweep",
        condition: {},
        targetAgentId: agentIds["Billing Chaser"]!,
        input: "Run the daily overdue-invoice sweep.",
      },
    }),
    await ensureSignalWithRule(teamId, {
      name: "Inbound 'meeting' email",
      kind: "event",
      source: "gmail",
      config: { keyword: "meeting" },
      rule: {
        name: "Meeting requests → Scheduler",
        condition: { path: "subject", contains: "meeting" },
        targetAgentId: agentIds["Scheduler"]!,
        input: "Propose meeting slots for this request.",
      },
    }),
  ];

  // 5) Queue the demo runs the simulator will drive.
  const runIds = [
    await queueDemoRun(
      teamId,
      agentIds["Inbox Triage"]!,
      projectId,
      triageTaskId,
      {
        steps: ["Scanned 24 new emails.", "12 archived, 9 to respond, 3 escalated."],
        notify: { connectionId: channel.connectionId, identityId: channel.identityId, chatId: channel.chatId, text: "Inbox triaged: 9 need a reply, 3 escalated." },
      },
      "Triage today's inbox and summarise.",
    ),
    await queueDemoRun(
      teamId,
      agentIds["Billing Chaser"]!,
      projectId,
      invoiceTaskId,
      {
        requireApproval: true,
        steps: ["Found invoice #42 (€2,400) overdue by 12 days.", "Drafted a polite reminder."],
        email: {
          to: OPERATOR_EMAIL,
          subject: "Friendly reminder: invoice #42 is overdue",
          text: "Hello,\n\nOur records show invoice #42 (€2,400) is 12 days overdue. Could you let us know when we can expect payment?\n\nThank you,\nBilling team",
        },
        notify: { connectionId: channel.connectionId, identityId: channel.identityId, chatId: channel.chatId, text: "Invoice #42 reminder sent after approval." },
      },
      "Chase overdue invoice #42 — draft and (after approval) send the reminder.",
    ),
    await queueDemoRun(
      teamId,
      agentIds["Scheduler"]!,
      projectId,
      meetingTaskId,
      {
        requireApproval: true,
        steps: ["Checked availability.", "Proposed Tue 10:00, Wed 14:00, Thu 09:30."],
        email: {
          to: OPERATOR_EMAIL,
          subject: "Acme kickoff — proposed slots",
          text: "Hi,\n\nFor the Acme kickoff, would any of these work: Tue 10:00, Wed 14:00, Thu 09:30?\n\nBest,\nScheduling assistant",
        },
      },
      "Schedule the Acme kickoff — propose slots and draft the invite.",
    ),
  ];

  return {
    teamId,
    agents: agentIds,
    projectId,
    taskIds: [triageTaskId, invoiceTaskId, meetingTaskId],
    signalIds,
    channel,
    runIds,
    gmailWebhookToken,
  };
}
