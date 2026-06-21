import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "./env";

/**
 * Credential encryption at rest — AES-256-GCM. The 32-byte key is derived
 * (scrypt) from CREDENTIALS_ENCRYPTION_KEY. In dev, an insecure fallback is used
 * with a loud warning so the engine still boots; production MUST set the env var.
 *
 * Stored format: `iv:authTag:ciphertext`, each base64. GCM's auth tag makes
 * tampering detectable (decrypt throws on a modified blob).
 */
function deriveKey(secret?: string): Buffer {
  if (!secret) {
    console.warn(
      "[engine] CREDENTIALS_ENCRYPTION_KEY is unset — using an INSECURE dev key. Set it before production.",
    );
  }
  return scryptSync(secret ?? "dev-insecure-credentials-key-change-me", "agentik-credentials", 32);
}

const KEY = deriveKey(env.CREDENTIALS_ENCRYPTION_KEY);

export function encryptJson(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptJson<T = Record<string, string>>(blob: string): T {
  const [ivB, tagB, encB] = blob.split(":");
  if (!ivB || !tagB || !encB) throw new Error("Malformed credential blob.");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
