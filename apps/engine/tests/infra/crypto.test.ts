import { afterEach, describe, expect, test } from "bun:test";
import { decryptJson, deriveKey, encryptJson } from "../../src/infra/crypto";

describe("master key hardening", () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
  });

  test("refuses to derive a key in production without a secret", () => {
    process.env.NODE_ENV = "production";
    expect(() => deriveKey(undefined)).toThrow(/CREDENTIALS_ENCRYPTION_KEY is required/);
  });

  test("derives a key in production when a secret is provided", () => {
    process.env.NODE_ENV = "production";
    expect(deriveKey("a-real-production-secret").length).toBe(32);
  });

  test("falls back to the dev key outside production", () => {
    process.env.NODE_ENV = "test";
    expect(deriveKey(undefined).length).toBe(32);
  });
});

describe("credential encryption", () => {
  test("round-trips a secret object", () => {
    const secret = { token: "xoxb-abc123", note: "héllo" };
    const blob = encryptJson(secret);
    expect(blob).not.toContain("xoxb-abc123"); // not stored in clear
    expect(blob.split(":")).toHaveLength(3); // iv:tag:ciphertext
    expect(decryptJson<typeof secret>(blob)).toEqual(secret);
  });

  test("produces a different ciphertext each time (random IV)", () => {
    expect(encryptJson({ a: "1" })).not.toBe(encryptJson({ a: "1" }));
  });

  test("rejects a tampered blob (GCM auth tag)", () => {
    const [iv, tag, ct] = encryptJson({ a: "1" }).split(":");
    const flipped = ct!.slice(0, -2) + (ct!.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptJson(`${iv}:${tag}:${flipped}`)).toThrow();
  });
});
