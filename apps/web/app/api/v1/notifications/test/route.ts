import type { NotificationConfig, NotificationResult } from "@/features/hermes-lite/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    config?: NotificationConfig;
    title?: string;
    summary?: string;
  };
  const config = body.config;
  const title = String(body.title || "Hermes Lite");
  const summary = String(body.summary || "Notification de test.");

  if (!config) {
    return Response.json({ results: [] });
  }

  const results: NotificationResult[] = [];

  if (config.discord.enabled) {
    results.push(await sendDiscord(config.discord.webhookUrl, title, summary));
  }

  if (config.telegram.enabled) {
    results.push(await sendTelegram(config.telegram.botToken, config.telegram.chatId, title, summary));
  }

  return Response.json({ results });
}

async function sendDiscord(webhookUrl: string, title: string, summary: string): Promise<NotificationResult> {
  if (!isHttps(webhookUrl)) {
    return { channel: "discord", ok: false, message: "Webhook Discord manquant ou invalide." };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: `**${title}**\n${summary}`,
        allowed_mentions: { parse: [] },
      }),
    });
    return {
      channel: "discord",
      ok: response.ok,
      status: response.status,
      message: response.ok ? "Notification Discord envoyee." : `Discord a repondu ${response.status}.`,
    };
  } catch {
    return { channel: "discord", ok: false, message: "Echec reseau Discord." };
  }
}

async function sendTelegram(botToken: string, chatId: string, title: string, summary: string): Promise<NotificationResult> {
  if (!botToken.trim() || !chatId.trim()) {
    return { channel: "telegram", ok: false, message: "Token bot ou chat id Telegram manquant." };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${title}\n\n${summary}`,
        disable_web_page_preview: true,
      }),
    });
    return {
      channel: "telegram",
      ok: response.ok,
      status: response.status,
      message: response.ok ? "Notification Telegram envoyee." : `Telegram a repondu ${response.status}.`,
    };
  } catch {
    return { channel: "telegram", ok: false, message: "Echec reseau Telegram." };
  }
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
