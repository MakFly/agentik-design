/**
 * Minimal SMTP client — just enough to deliver a plaintext message to a local
 * relay with no auth/TLS (dev = infra-mailpit on localhost:1025). Not a general
 * mailer: in production the engine talks to a real provider, not this path.
 */

const SMTP_HOST = process.env.SMTP_HOST ?? "localhost";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 1025);

export interface OutboundMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function encodeMimeHeader(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export function buildMailMessage(mail: OutboundMail): string {
  return [
    `From: ${encodeMimeHeader(mail.from)}`,
    `To: ${encodeMimeHeader(mail.to)}`,
    `Subject: ${encodeMimeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    mail.text,
  ].join("\r\n");
}

/** Pull the next complete SMTP reply (final line = `NNN ` with a space) from a buffer. */
function nextReply(buffer: string): { code: string; rest: string } | null {
  const parts = buffer.split("\r\n");
  for (let i = 0; i < parts.length - 1; i++) {
    if (/^\d{3} /.test(parts[i]!)) {
      return { code: parts[i]!.slice(0, 3), rest: parts.slice(i + 1).join("\r\n") };
    }
  }
  return null;
}

/** Deliver a message over SMTP. Resolves on a 250 after QUIT; rejects on 4xx/5xx/timeout. */
export function sendMail(mail: OutboundMail): Promise<void> {
  const message = buildMailMessage(mail);
  const commands = [
    "EHLO agentik.local",
    `MAIL FROM:<${mail.from}>`,
    `RCPT TO:<${mail.to}>`,
    "DATA",
  ];

  return new Promise((resolve, reject) => {
    let buffer = "";
    let phase: "greeting" | "commands" | "data" | "body" | "quit" = "greeting";
    let cmdIndex = 0;
    let settled = false;
    let socket: import("bun").Socket | null = null;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.end();
      } catch {
        /* ignore */
      }
      err ? reject(err) : resolve();
    };

    const send = (line: string) => socket?.write(line + "\r\n");

    const onReply = (code: string) => {
      if (code.startsWith("4") || code.startsWith("5")) {
        return done(new Error(`SMTP rejected with ${code}`));
      }
      switch (phase) {
        case "greeting":
          phase = "commands";
          send(commands[cmdIndex++]!);
          break;
        case "commands": {
          const cmd = commands[cmdIndex++];
          if (cmd) {
            send(cmd);
            if (cmd === "DATA") phase = "data";
          }
          break;
        }
        case "data":
          phase = "body";
          socket?.write(message + "\r\n.\r\n");
          break;
        case "body":
          phase = "quit";
          send("QUIT");
          break;
        case "quit":
          done();
          break;
      }
    };

    const timer = setTimeout(() => done(new Error("smtp_timeout")), 5000);

    Bun.connect({
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      socket: {
        open(s) {
          socket = s;
        },
        data(_s, chunk) {
          buffer += chunk.toString();
          let reply = nextReply(buffer);
          while (reply) {
            buffer = reply.rest;
            onReply(reply.code);
            if (settled) return;
            reply = nextReply(buffer);
          }
        },
        error(_s, err) {
          done(err instanceof Error ? err : new Error(String(err)));
        },
        close() {
          if (!settled) done();
        },
      },
    }).catch((err) => done(err instanceof Error ? err : new Error(String(err))));
  });
}
