import { describe, expect, test } from "bun:test";
import { encryptJson, decryptJson } from "./infra/crypto";

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
