import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "./env";
import { agentikHome, isSolo } from "./mode";

/**
 * Solo mode has no env to hold secrets, so persist a real per-install key at
 * ~/.agentik/credentials/key (generated once, 0600). This replaces the insecure dev
 * fallback with a stable, machine-local secret — credentials encrypt at rest for real.
 */
function soloKeySecret(): string {
  const dir = path.join(agentikHome(), "credentials");
  const keyPath = path.join(dir, "key");
  if (existsSync(keyPath)) return readFileSync(keyPath, "utf8").trim();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(keyPath, secret + "\n", { mode: 0o600 });
  return secret;
}

/**
 * Credential encryption at rest — AES-256-GCM. The 32-byte key is derived
 * (scrypt) from CREDENTIALS_ENCRYPTION_KEY. Outside production an insecure fallback
 * is used with a loud warning so the engine still boots; in production the engine
 * REFUSES to boot without the env var (a fixed dev key would expose every tenant's
 * provider secrets if it ever leaked).
 *
 * Stored format: `iv:authTag:ciphertext`, each base64. GCM's auth tag makes
 * tampering detectable (decrypt throws on a modified blob).
 */
export function deriveKey(secret?: string): Buffer {
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[engine] CREDENTIALS_ENCRYPTION_KEY is required in production — refusing to boot with an insecure dev key.",
      );
    }
    console.warn(
      "[engine] CREDENTIALS_ENCRYPTION_KEY is unset — using an INSECURE dev key. Set it before production.",
    );
  }
  return scryptSync(secret ?? "dev-insecure-credentials-key-change-me", "agentik-credentials", 32);
}

const KEY = deriveKey(
  env.CREDENTIALS_ENCRYPTION_KEY ?? (isSolo ? soloKeySecret() : undefined),
);

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
