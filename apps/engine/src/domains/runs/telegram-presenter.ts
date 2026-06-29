type RecordValue = Record<string, unknown>;

export type TelegramRunCompletion = {
  text: string;
  includeLink: boolean;
};

export type TelegramRunProgressInput = {
  completedSteps: number;
  stepCount: number;
  latest?: string | null;
};

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === "object" ? (value as RecordValue) : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  const record = asRecord(result);
  if (record) {
    const value = record.result;
    if (typeof value === "string") return value;
    const echo = record.echo;
    if (typeof echo === "string") return echo;
  }
  return result == null ? "" : JSON.stringify(result);
}

function compactSnippet(value: unknown, max = 96): string {
  const text = stringOf(value)?.replace(/\s+/g, " ") ?? "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function taskTitle(value: string): string {
  return value
    .split(/\s+[—-]\s+/)[0]
    ?.replace(/\s+/g, " ")
    .trim() || value.trim();
}

function isEchoSuccess(result: RecordValue): boolean {
  return result.ok === true && typeof result.echo === "string";
}

function presentableProgressLatest(latest: unknown): string {
  const text = compactSnippet(latest, 140);
  const completedTool = text.match(/^Completed\s+([a-z0-9_.-]+)(?:\s+·\s+(.+))?$/i);
  if (!completedTool) return text;

  const tool = completedTool[1]?.toLowerCase() ?? "";
  const label = completedTool[2]?.trim();
  if (tool === "search" && label) return `Contexte vérifié : ${taskTitle(label)}`;
  if (label) return `Étape terminée : ${taskTitle(label)}`;
  return "Étape terminée.";
}

function parseTransport(value: unknown) {
  return value === "gmail" ? "Gmail" : value === "mailpit" ? "Mailpit" : stringOf(value);
}

function gmailSendPresentation(result: RecordValue): TelegramRunCompletion | null {
  if (result.skill !== "gmail.send") return null;
  const email = asRecord(result.email);
  const to = stringOf(email?.to);
  const subject = stringOf(email?.subject);
  const transport = parseTransport(email?.transport);
  const delivered = email?.delivered !== false;

  if (!delivered) {
    return {
      includeLink: true,
      text: [
        "Je n'ai pas pu envoyer l'email.",
        to ? `À : ${to}` : null,
        subject ? `Objet : ${subject}` : null,
        stringOf(result.result),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    includeLink: false,
    text: [
      "Email envoyé.",
      "",
      to ? `À : ${to}` : null,
      subject ? `Objet : ${subject}` : null,
      transport ? `Canal : ${transport}` : null,
      "",
      "Je l'ai bien expédié depuis le compte connecté.",
    ]
      .filter((line) => line != null)
      .join("\n")
      .trim(),
  };
}

function gmailReadPresentation(result: RecordValue): TelegramRunCompletion | null {
  if (result.skill !== "gmail.read") return null;
  const emails = Array.isArray(result.emails)
    ? result.emails.filter((item): item is RecordValue => Boolean(item && typeof item === "object"))
    : [];
  if (!emails.length) {
    return {
      includeLink: false,
      text: "Je n'ai trouvé aucun email récent dans la boîte connectée.",
    };
  }

  const urgent = emails.find((email) =>
    /\b(expire|urgent|invitation|opportunit|token|security|sécurit|alerte)\b/i.test(
      `${email.subject ?? ""} ${email.snippet ?? ""}`,
    ),
  );
  const lines = [`J'ai trouvé ${emails.length} emails récents.`, "", "À traiter :"];
  for (const [index, email] of emails.slice(0, 5).entries()) {
    const subject = stringOf(email.subject) ?? "(sans objet)";
    const from = stringOf(email.fromName) ?? stringOf(email.from) ?? "expéditeur inconnu";
    const snippet = compactSnippet(email.snippet);
    lines.push(`${index + 1}. ${subject}`);
    lines.push(`   ${from}${snippet ? ` · ${snippet}` : ""}`);
  }
  if (urgent) {
    lines.push(
      "",
      `Le point à regarder en premier : ${stringOf(urgent.subject) ?? "un email récent"}.`,
    );
  }
  return { includeLink: false, text: lines.join("\n") };
}

export function formatRunCompletionForTelegram(result: unknown): TelegramRunCompletion {
  const record = asRecord(result);
  if (record) {
    const skillSpecific = gmailSendPresentation(record) ?? gmailReadPresentation(record);
    if (skillSpecific) return skillSpecific;
    if (isEchoSuccess(record)) {
      const title = taskTitle(resultText(record));
      return {
        includeLink: true,
        text: [
          "J'ai terminé la tâche.",
          title ? `Résultat : ${title}` : null,
          "",
          "Le run contient le détail technique et les traces d'exécution.",
        ]
          .filter((line) => line != null)
          .join("\n")
          .trim(),
      };
    }
  }

  const text = resultText(result);
  return {
    includeLink: true,
    text: ["J'ai terminé ce run.", text ? `Résumé : ${text}` : null].filter(Boolean).join("\n"),
  };
}

export function formatRunProgressForTelegram(progress: TelegramRunProgressInput): string {
  const latest = presentableProgressLatest(progress.latest);
  return [
    "Je suis dessus.",
    `${progress.completedSteps}/${progress.stepCount} étapes terminées.`,
    latest ? `Dernière action : ${latest}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRunApprovalForTelegram(runId: string, message: string): TelegramRunCompletion {
  const cleanMessage = compactSnippet(message, 180);
  return {
    includeLink: true,
    text: [
      "J'ai besoin de ton accord avant de continuer.",
      cleanMessage ? `Action : ${cleanMessage}` : null,
      "",
      `Approuver : /approve ${runId} ok`,
      `Refuser : /reject ${runId} raison`,
    ]
      .filter((line) => line != null)
      .join("\n")
      .trim(),
  };
}

export function runApprovalTelegramActions(runId: string) {
  return {
    inline_keyboard: [
      [
        { text: "Approuver", callback_data: `run:approve:${runId}` },
        { text: "Refuser", callback_data: `run:reject:${runId}` },
      ],
    ],
  };
}

export function formatRunFailureForTelegram(error: string): TelegramRunCompletion {
  const cleanError = compactSnippet(error, 220);
  return {
    includeLink: true,
    text: [
      "Je me suis arrêté sur une erreur.",
      cleanError ? `Raison : ${cleanError}` : null,
      "Le détail est dans le run.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
