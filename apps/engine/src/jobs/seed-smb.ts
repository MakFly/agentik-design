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
import { and, eq, inArray, sql } from "drizzle-orm";
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
  runMessages,
  memoryEntries,
  memoryEvents,
  skills,
  skillVersions,
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
  /** deterministic engine-side skills (see domains/chat/skills.ts) */
  skills?: string[];
  /** runtime adapter kind; defaults to "claude". Use "openai" for the API-key path. */
  runtimeKind?: string;
}

const AGENTS: AgentDef[] = [
  {
    // General-purpose default agent (OpenClaw's "main" equivalent). The chat opens
    // this one by default; it runs on the OpenAI provider key, no CLI needed.
    name: "Assistant",
    role: "operator",
    goal: "Be a helpful general-purpose assistant for anything the operator asks.",
    emoji: "💬",
    color: "#6366f1",
    systemPrompt:
      "You are Assistant, a helpful, concise general-purpose AI assistant. Answer directly and clearly. Ask for clarification only when truly needed.",
    runtimeKind: "openai",
  },
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
    skills: ["gmail.read"],
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
    runtimeKind: def.runtimeKind ?? "claude",
    skills: def.skills ?? [],
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

async function ensureMemoryEntry(
  teamId: string,
  input: {
    scope: "team" | "agent";
    targetId?: string | null;
    content: string;
    confidence: number;
    createdBy?: "system" | "review_agent";
  },
) {
  const targetId = input.scope === "team" ? null : input.targetId ?? null;
  const [existing] = await db
    .select({ id: memoryEntries.id })
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.teamId, teamId),
        eq(memoryEntries.scope, input.scope),
        targetId ? eq(memoryEntries.targetId, targetId) : sql`${memoryEntries.targetId} is null`,
        eq(memoryEntries.content, input.content),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const id = genId("mem");
  const createdBy = input.createdBy ?? "system";
  await db.insert(memoryEntries).values({
    id,
    teamId,
    scope: input.scope,
    targetId,
    content: input.content,
    confidence: input.confidence,
    createdBy,
    lastEditedBy: createdBy,
  });
  await db.insert(memoryEvents).values({
    id: genId("mevt"),
    teamId,
    memoryId: id,
    action: "create",
    actorId: createdBy,
    before: null,
    after: {
      id,
      scope: input.scope,
      targetId,
      content: input.content,
      confidence: input.confidence,
      createdBy,
    },
  });
  return id;
}

async function ensureSkill(
  teamId: string,
  input: {
    name: string;
    description: string;
    scope: "team" | "agent";
    targetId?: string | null;
    bodyMd: string;
    triggerConditions: string[];
    pitfalls?: string[];
    verificationSteps?: string[];
  },
) {
  const targetId = input.scope === "team" ? null : input.targetId ?? null;
  const [existing] = await db
    .select({ id: skills.id, currentVersionId: skills.currentVersionId })
    .from(skills)
    .where(
      and(
        eq(skills.teamId, teamId),
        eq(skills.name, input.name),
        eq(skills.scope, input.scope),
        targetId ? eq(skills.targetId, targetId) : sql`${skills.targetId} is null`,
      ),
    )
    .limit(1);
  if (existing?.currentVersionId) return existing.id;

  const skillId = existing?.id ?? genId("skill");
  const versionId = genId("sver");
  if (!existing) {
    await db.insert(skills).values({
      id: skillId,
      teamId,
      name: input.name,
      description: input.description,
      scope: input.scope,
      targetId,
      currentVersionId: versionId,
      createdBy: "review_agent",
    });
  }
  await db.insert(skillVersions).values({
    id: versionId,
    skillId,
    version: 1,
    bodyMd: input.bodyMd,
    triggerConditions: input.triggerConditions,
    pitfalls: input.pitfalls ?? [],
    verificationSteps: input.verificationSteps ?? [],
    createdBy: "review_agent",
    changelog: "Seed Hermes memory system",
  });
  if (existing) {
    await db
      .update(skills)
      .set({ currentVersionId: versionId, updatedAt: sql`now()` })
      .where(eq(skills.id, skillId));
  }
  return skillId;
}

async function ensureHermesKnowledge(teamId: string, agentIds: Record<string, string>) {
  await ensureMemoryEntry(teamId, {
    scope: "team",
    content: "Les emails sortants demandent une approbation operateur avant envoi.",
    confidence: 0.95,
  });
  await ensureMemoryEntry(teamId, {
    scope: "team",
    content: "Le canal Telegram sert de passerelle operateur: resumer l'action, demander validation si necessaire, puis notifier le resultat.",
    confidence: 0.9,
  });
  await ensureMemoryEntry(teamId, {
    scope: "agent",
    targetId: agentIds["Billing Chaser"]!,
    content: "Pour les relances facture, rester poli, factuel, et mentionner la facture uniquement si elle est identifiee dans le contexte.",
    confidence: 0.92,
  });
  await ensureMemoryEntry(teamId, {
    scope: "agent",
    targetId: agentIds["Scheduler"]!,
    content: "Pour une proposition de meeting, donner trois creneaux lisibles et laisser l'humain approuver l'envoi.",
    confidence: 0.9,
  });

  await ensureSkill(teamId, {
    name: "Relance facture approuvee",
    description: "Procedure de relance email avec approbation humaine.",
    scope: "agent",
    targetId: agentIds["Billing Chaser"]!,
    triggerConditions: ["facture en retard", "demande de relance", "gmail.send"],
    bodyMd:
      "Verifier le contexte de la facture, rediger un message court et poli, puis demander l'approbation operateur avant tout envoi Gmail.",
    pitfalls: ["Ne jamais inventer un montant ou une date d'echeance.", "Ne pas envoyer sans approbation."],
    verificationSteps: ["Le destinataire, le sujet et le corps sont visibles avant approbation.", "Le run reste en attente tant que l'humain n'a pas valide."],
  });
  await ensureSkill(teamId, {
    name: "Proposition de creneaux",
    description: "Procedure de brouillon email pour organiser une reunion.",
    scope: "agent",
    targetId: agentIds["Scheduler"]!,
    triggerConditions: ["meeting", "kickoff", "propose slots"],
    bodyMd:
      "Proposer trois creneaux, formater le sujet sans caracteres corrompus, et attendre validation avant d'envoyer le brouillon.",
    pitfalls: ["Eviter les caracteres mal encodes dans le sujet.", "Ne pas confirmer un rendez-vous sans accord explicite."],
    verificationSteps: ["Le sujet email est lisible en UTF-8.", "Le message Telegram resume clairement les creneaux proposes."],
  });
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

/**
 * Seed an already-completed (historical) run for a task. Unlike `queueDemoRun`,
 * this never sits in `queued`, so no live daemon claims it and nothing fires when
 * an agent is (re)published — it only populates run history. Run messages are
 * written so the run detail + agent timeline look real.
 */
async function seedHistoricalRun(
  teamId: string,
  agentId: string,
  projectId: string,
  taskId: string,
  steps: string[],
  prompt: string,
): Promise<string> {
  const runId = genId("run");
  const lines = [...steps, "Task completed successfully."];
  await db.insert(runs).values({
    id: runId,
    teamId,
    executor: "daemon",
    agentId,
    projectId,
    projectTaskId: taskId,
    status: "succeeded",
    kind: "chat",
    input: { prompt },
    result: { summary: "Completed (seeded history).", steps: lines.length },
    costCents: 1,
    stepCount: lines.length,
    completedSteps: lines.length,
    startedAt: sql`now()`,
    endedAt: sql`now()`,
  });
  await db.insert(runMessages).values(
    lines.map((content, i) => ({
      id: genId("amsg"),
      runId,
      seq: i + 1,
      type: "text" as const,
      content,
    })),
  );
  await db
    .update(projectTasks)
    .set({ status: "done", lastRunId: runId })
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

  // 2b) Hermes-style learned context: approved memories + procedural skills.
  await ensureHermesKnowledge(teamId, agentIds);

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

  // 5) Runs.
  //   - Inbox Triage: seeded as HISTORY (succeeded), so publishing/editing the
  //     agent never makes a live daemon claim a queued run. Two runs on the same
  //     task show per-task run traceability in the agent-centric views.
  //   - Billing/Scheduler: left queued + approval-gated so the simulator demo
  //     (/dev/simulate → approve → /dev/simulate) still has runs to drive.
  const runIds = [
    await seedHistoricalRun(
      teamId,
      agentIds["Inbox Triage"]!,
      projectId,
      triageTaskId,
      ["Scanned 18 new emails.", "9 archived, 7 to respond, 2 escalated."],
      "Triage today's inbox and summarise.",
    ),
    await seedHistoricalRun(
      teamId,
      agentIds["Inbox Triage"]!,
      projectId,
      triageTaskId,
      ["Scanned 24 new emails.", "12 archived, 9 to respond, 3 escalated."],
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
