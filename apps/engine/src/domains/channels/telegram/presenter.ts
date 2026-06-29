type RunStatusInput = {
  id: string;
  status: string;
  completedSteps: number;
  stepCount: number;
  placement?: string | null;
  url: string;
};

type RunControlAction = "cancel" | "pause" | "resume" | "approve" | "reject";
type AgentListItem = {
  id: string;
  name: string;
  handle: string;
  health?: string | null;
  model?: string | null;
};
type ProjectListItem = {
  id: string;
  name: string;
  openTaskCount: number;
  type?: string | null;
};
type TaskListItem = {
  id: string;
  title: string;
  priority: string;
  status: string;
  projectName: string;
};
type ProjectContextInput = {
  project: {
    id: string;
    name: string;
    type?: string | null;
    description?: string | null;
  };
  tasks: Array<{
    id: string;
    title: string;
    priority: string;
    status: string;
  }>;
  resources: Array<{
    type: string;
    label: string;
    ref: string;
  }>;
  memories: Array<{
    content: string;
    confidence?: number | null;
  }>;
};
type AgentSkillsInput = {
  id: string;
  name: string;
  handle: string;
  role?: string | null;
  goal?: string | null;
  health?: string | null;
  runtimeKind: string;
  model?: string | null;
  published: boolean;
  version?: number | null;
  instructions?: string | null;
  tools: string[];
  toolGrants: Array<{ toolId?: string; scopes?: string[]; requireApproval?: boolean }>;
};

const RUN_CONTROL_COPY: Record<
  RunControlAction,
  { ok: string; failed: string }
> = {
  cancel: {
    ok: "J'ai arrêté ce run.",
    failed: "Je n'ai pas pu arrêter ce run. Il est peut-être déjà terminé ou introuvable.",
  },
  pause: {
    ok: "J'ai mis ce run en pause.",
    failed: "Je n'ai pas pu mettre ce run en pause. Il n'est peut-être plus actif.",
  },
  resume: {
    ok: "Je relance ce run.",
    failed: "Je n'ai pas pu relancer ce run. Il n'est pas en pause ou il est introuvable.",
  },
  approve: {
    ok: "Accord reçu. Je reprends l'exécution.",
    failed: "Je n'ai trouvé aucune demande d'accord active pour ce run.",
  },
  reject: {
    ok: "Refus enregistré. J'arrête ce run.",
    failed: "Je n'ai trouvé aucune demande d'accord active pour ce run.",
  },
};

function linkLine(url: string) {
  return `Détail : ${url}`;
}

export function formatRunStartedReply(input: {
  agentName?: string | null;
  title?: string | null;
  placement?: string | null;
  url: string;
}) {
  return [
    input.agentName ? `${input.agentName} est dessus.` : "C'est lancé.",
    input.title ? `Tâche : ${input.title}` : null,
    input.placement ? `Runtime : ${input.placement}` : null,
    "Je te renvoie le résultat ici dès que c'est terminé.",
    linkLine(input.url),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatOrchestrationStartedReply(input: {
  steps: number;
  childRunId?: string;
  url: string;
}) {
  return [
    "J'ai lancé l'orchestration.",
    `${input.steps} étapes prévues.`,
    input.childRunId ? `Étape active : ${input.childRunId}` : null,
    "Je garde le détail dans le run et je te remonte les jalons utiles ici.",
    linkLine(input.url),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRunStatusReply(input: RunStatusInput) {
  return [
    "Voici l'état actuel.",
    `Statut : ${input.status}`,
    `Progression : ${input.completedSteps}/${input.stepCount}`,
    input.placement ? `Runtime : ${input.placement}` : null,
    linkLine(input.url),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRunControlReply(
  action: RunControlAction,
  ok: boolean,
  input: { url?: string },
) {
  const copy = RUN_CONTROL_COPY[action];
  return [ok ? copy.ok : copy.failed, ok && input.url ? linkLine(input.url) : null]
    .filter(Boolean)
    .join("\n");
}

export function formatActiveAgentReply(input: {
  handle: string;
  name: string;
}) {
  return [
    `Je garde @${input.handle} comme agent actif.`,
    `${input.name} répondra aux prochains messages de ce chat sans /run.`,
  ].join("\n");
}

export function formatActiveAgentDisabledReply() {
  return "Mode agent désactivé. Utilise /agent @agent_handle pour en choisir un autre.";
}

export function formatActiveProjectReply(input: {
  id: string;
  name: string;
}) {
  return [
    `Je garde ${input.name} comme projet actif.`,
    `/tasks et /learn utiliseront ce projet dans ce chat.`,
    `Projet : ${input.id}`,
  ].join("\n");
}

export function formatActiveProjectDisabledReply() {
  return "Projet actif désactivé. Utilise /project <projectId> pour en choisir un autre.";
}

export function formatCurrentProjectHelpReply(input: {
  current?: { id: string; name: string } | null;
}) {
  return input.current
    ? [
        `Projet actif : ${input.current.name}.`,
        `Projet : ${input.current.id}`,
        "/project off pour le désactiver.",
      ].join("\n")
    : "Aucun projet actif pour ce chat. Utilise /projects puis /project <projectId>.";
}

export function formatAgentUnavailableReply(reason: string) {
  return [
    "Je ne peux pas lancer cet agent pour l'instant.",
    `Raison : ${reason}`,
    "Vérifie l'agent, sa publication et son runtime, puis réessaie.",
  ].join("\n");
}

export function formatCommandError(message: string) {
  return ["Je ne peux pas exécuter cette commande.", message].filter(Boolean).join("\n");
}

export function formatHelpReply(pairingCode: string) {
  return [
    "Agentik est prêt sur Telegram.",
    "",
    "Commandes utiles :",
    "/projects — voir les projets",
    "/project <projectId> — choisir le projet actif du chat",
    "/context [project:<projectId>] — voir le contexte utilisé",
    "/agents — voir les agents publiés",
    "/skills [@agent_handle] — voir les capacités d'un agent",
    "/tasks [project:<projectId>] — voir les tâches ouvertes",
    '/run "titre de tâche" — créer et lancer dans le projet actif',
    '/run @agent_handle "demande" — lancer un agent',
    '/orchestrate "étape 1 puis étape 2" — lancer plusieurs agents',
    "/next [runId] — avancer les runs en queue de la démo locale",
    "/status [runId] — suivre le run actif ou un run précis",
    "/pause [runId] /resume [runId]",
    "/approve [runId] ok /reject [runId] raison",
    "",
    `Pairing : /start ${pairingCode}`,
  ].join("\n");
}

export function formatRunHelpReply(input: {
  intro?: string;
  agents: AgentListItem[];
  projects: ProjectListItem[];
}) {
  const lines = [
    input.intro ??
      "Je peux lancer une tâche, router un message vers le bon agent, ou garder un agent actif dans ce chat.",
    "",
    "Chemins rapides :",
    '/run "titre de tâche"',
    '/run @agent_handle "demande"',
    '/run task:<taskId> "instruction optionnelle"',
    '/orchestrate "recherche puis action"',
    "/next [runId]",
    "/agent @agent_handle",
    "/agent off",
  ];
  if (input.agents.length) {
    lines.push("", "Agents disponibles :", ...formatAgentLines(input.agents.slice(0, 6)));
  }
  if (input.projects.length) {
    lines.push("", "Projets actifs :", ...formatProjectLines(input.projects.slice(0, 6)));
  }
  lines.push("", "Pour voir le travail ouvert : /tasks");
  return lines.join("\n");
}

export function formatAgentsReply(agents: AgentListItem[]) {
  if (!agents.length) return "Aucun agent disponible pour l'instant.";
  return ["Agents prêts à travailler :", ...formatAgentLines(agents.slice(0, 10))].join("\n");
}

export function formatAgentSkillsReply(input: AgentSkillsInput) {
  const grants = input.toolGrants.length
    ? input.toolGrants
        .slice(0, 8)
        .map((grant) =>
          [
            grant.toolId ?? "tool",
            grant.scopes?.length ? `scopes: ${grant.scopes.join(",")}` : null,
            grant.requireApproval ? "approval" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        )
    : [];
  const tools = grants.length ? grants : input.tools.slice(0, 8);
  return [
    `Capacités : ${input.name}`,
    `Agent : @${input.handle} · ${input.id}`,
    input.role ? `Rôle : ${compactLine(input.role, 120)}` : null,
    input.goal ? `Objectif : ${compactLine(input.goal, 160)}` : null,
    `Runtime : ${input.runtimeKind}${input.model ? ` · ${input.model}` : ""}`,
    `État : ${input.published ? `publié${input.version ? ` v${input.version}` : ""}` : "non publié"}${input.health ? ` · ${input.health}` : ""}`,
    "",
    "Outils :",
    tools.length ? tools.map((tool) => `- ${compactLine(tool, 120)}`).join("\n") : "Aucun outil déclaré.",
    input.instructions ? ["", `Instruction : ${compactLine(input.instructions, 260)}`].join("\n") : null,
    "",
    `Lancer : /run @${input.handle} "demande"`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatProjectsReply(projects: ProjectListItem[]) {
  if (!projects.length) return "Aucun projet actif pour l'instant.";
  return [
    "Projets actifs :",
    ...formatProjectLines(projects.slice(0, 8)),
    "",
    "Choisir le contexte du chat : /project <projectId>",
  ].join("\n");
}

export function formatTasksReply(tasks: TaskListItem[]) {
  if (!tasks.length) return "Aucune tâche ouverte pour l'instant.";
  return [
    "Tâches ouvertes :",
    ...tasks.slice(0, 10).map((task) =>
      [
        `${task.priority} ${task.title}`,
        `Projet : ${task.projectName}`,
        `Statut : ${task.status}`,
        `Lancer : /run task:${task.id}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

export function formatProjectContextReply(input: ProjectContextInput) {
  const lines = [
    `Contexte actif : ${input.project.name}`,
    `Projet : ${input.project.id}${input.project.type ? ` · ${input.project.type}` : ""}`,
    input.project.description ? `Résumé : ${compactLine(input.project.description, 180)}` : null,
  ].filter(Boolean) as string[];

  lines.push("", "Tâches ouvertes :");
  const openTasks = input.tasks
    .filter((task) => !["done", "cancelled"].includes(task.status))
    .slice(0, 5);
  if (openTasks.length) {
    lines.push(
      ...openTasks.map((task) =>
        `${task.priority} ${compactLine(task.title, 92)} · ${task.status} · ${task.id}`,
      ),
    );
  } else {
    lines.push("Aucune tâche ouverte.");
  }

  lines.push("", "Ressources :");
  if (input.resources.length) {
    lines.push(
      ...input.resources.slice(0, 5).map((resource) =>
        `${resource.type} · ${compactLine(resource.label || resource.ref, 80)}`,
      ),
    );
  } else {
    lines.push("Aucune ressource liée.");
  }

  lines.push("", "Mémoires confirmées :");
  if (input.memories.length) {
    lines.push(
      ...input.memories.slice(0, 5).map((memory) =>
        `- ${compactLine(memory.content, 120)}`,
      ),
    );
  } else {
    lines.push("Aucune mémoire confirmée.");
  }

  lines.push("", "Prochaine action : /run \"titre de tâche\" ou /learn \"fait confirmé\"");
  return lines.join("\n");
}

export function formatPairingReply(kind: "paired" | "already" | "invalid", pairingCode?: string) {
  if (kind === "paired") {
    return [
      "Ce chat est connecté à Agentik.",
      "Tu peux lancer /projects, /agents ou écrire directement une demande.",
    ].join("\n");
  }
  if (kind === "already") return "Ce chat est déjà connecté. Envoie /projects ou /agents pour commencer.";
  return [
    "Code de pairing invalide.",
    "Ouvre Channels dans Agentik et copie le code /start actuel.",
    pairingCode ? `Format attendu : /start ${pairingCode}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatUnpairedReply(pairingCode: string) {
  return [
    "Ce chat n'est pas encore connecté.",
    `Envoie : /start ${pairingCode}`,
  ].join("\n");
}

export function formatCurrentAgentHelpReply(input: {
  current?: { handle: string; name: string } | null;
}) {
  return input.current
    ? `Agent actif : @${input.current.handle} (${input.current.name}).`
    : "Aucun agent actif pour ce chat.";
}

export function formatAgentNotFoundReply(handle?: string) {
  return [
    handle ? `Je ne trouve pas @${handle}.` : "Je ne trouve pas cet agent.",
    "Utilise /agents pour voir les handles disponibles.",
  ].join("\n");
}

export function formatAmbiguousAgentsReply(agents: AgentListItem[]) {
  return [
    "Plusieurs agents correspondent.",
    "Relance avec un id explicite :",
    ...formatAgentLines(agents),
  ].join("\n");
}

function formatAgentLines(agents: AgentListItem[]) {
  return agents.map((agent) =>
    [
      `${agent.name} · @${agent.handle}`,
      `   ${agent.id}${agent.health ? ` · ${agent.health}` : ""}${agent.model ? ` · ${agent.model}` : ""}`,
    ].join("\n"),
  );
}

function formatProjectLines(projects: ProjectListItem[]) {
  return projects.map((project) =>
    [
      project.name,
      `   ${project.id} · ${project.openTaskCount} ouvertes${project.type ? ` · ${project.type}` : ""}`,
    ].join("\n"),
  );
}

function compactLine(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
