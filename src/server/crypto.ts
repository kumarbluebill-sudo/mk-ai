import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (e.g. supplier credentials).
 * Ciphertext format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */

const VERSION = "v1";

function loadKey(key?: string): Buffer {
  const raw = key ?? process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  // Accept 64 hex characters (e.g. `openssl rand -hex 32`) or base64 (`openssl rand -base64 32`).
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes, hex or base64 encoded");
  }
  return buf;
}

export function encryptSecret(plaintext: string, key?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string, key?: string): string {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported ciphertext format");
  }
  const decipher = createDecipheriv("aes-256-gcm", loadKey(key), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptJson(value: unknown, key?: string): string {
  return encryptSecret(JSON.stringify(value), key);
}

export function decryptJson<T = unknown>(payload: string, key?: string): T {
  return JSON.parse(decryptSecret(payload, key)) as T;
}
