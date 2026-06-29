import { describe, expect, test } from "bun:test";
import { matchEmailSend, matchInboxRead } from "../../../src/domains/chat/skills";

describe("chat built-in skill intents", () => {
  test("does not treat email-send phrasing as inbox-read intent", () => {
    expect(matchInboxRead("tu peux m'envoyer un email à operator@example.test ?")).toEqual({
      match: false,
      count: 5,
    });
  });

  test("detects explicit inbox-read requests", () => {
    expect(matchInboxRead("donne moi les 5 derniers emails")).toEqual({
      match: true,
      count: 5,
    });
  });

  test("requires recipient, subject and body before email send is complete", () => {
    expect(matchEmailSend("envoie un email à operator@example.test")).toEqual({
      match: true,
      complete: false,
      to: "operator@example.test",
      subject: undefined,
      text: undefined,
      missing: ["subject", "body"],
    });
  });

  test("parses explicit French email send requests", () => {
    expect(
      matchEmailSend(
        'Envoie un email à operator@example.test avec le sujet "Test Telegram" et le message "Hello depuis Telegram."',
      ),
    ).toEqual({
      match: true,
      complete: true,
      to: "operator@example.test",
      subject: "Test Telegram",
      text: "Hello depuis Telegram.",
    });
  });

  test("parses ampersand-separated French email fields", () => {
    expect(
      matchEmailSend(
        'envoie un email à operator@example.test avec le sujet "Test" & message " Hello depuis télégram"',
      ),
    ).toEqual({
      match: true,
      complete: true,
      to: "operator@example.test",
      subject: "Test",
      text: "Hello depuis télégram",
    });
  });

  test("parses connector variants between labeled email fields", () => {
    expect(
      matchEmailSend(
        'envoie un email à operator@example.test sujet "Point rapide"; contenu "On se cale demain."',
      ),
    ).toEqual({
      match: true,
      complete: true,
      to: "operator@example.test",
      subject: "Point rapide",
      text: "On se cale demain.",
    });
  });

  test("parses explicit English email send requests", () => {
    expect(
      matchEmailSend(
        'send email to operator@example.test subject "Telegram test" body "Hello from Telegram."',
      ),
    ).toEqual({
      match: true,
      complete: true,
      to: "operator@example.test",
      subject: "Telegram test",
      text: "Hello from Telegram.",
    });
  });
});
