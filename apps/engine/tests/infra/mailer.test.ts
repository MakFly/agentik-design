import { describe, expect, test } from "bun:test";
import { buildMailMessage, encodeMimeHeader } from "../../src/infra/mailer";

describe("mailer RFC822 headers", () => {
  test("encodes non-ASCII subjects so clients do not display mojibake", () => {
    const subject = "Acme kickoff — proposed slots";
    const message = buildMailMessage({
      from: "assistant@agentik.dev",
      to: "operator@example.test",
      subject,
      text: "Créneau proposé : mercredi 14:00.",
    });

    expect(encodeMimeHeader(subject)).toBe("=?UTF-8?B?QWNtZSBraWNrb2ZmIOKAlCBwcm9wb3NlZCBzbG90cw==?=");
    expect(message).toContain("Subject: =?UTF-8?B?QWNtZSBraWNrb2ZmIOKAlCBwcm9wb3NlZCBzbG90cw==?=");
    expect(message).toContain("Content-Type: text/plain; charset=utf-8");
    expect(message).toContain("Content-Transfer-Encoding: 8bit");
    expect(message).toContain("Créneau proposé");
    expect(message).not.toContain("Ã¢Â€Â”");
  });

  test("sanitizes header injection attempts", () => {
    expect(encodeMimeHeader("Hello\r\nBcc: leaked@example.test")).toBe("Hello Bcc: leaked@example.test");
  });
});
