import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJson, decryptSecret, encryptJson, encryptSecret } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips a secret", () => {
    const enc = encryptSecret("super-secret", key);
    expect(enc).not.toContain("super-secret");
    expect(decryptSecret(enc, key)).toBe("super-secret");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("round-trips JSON", () => {
    const v = { apiKey: "abc", env: "sandbox" };
    expect(decryptJson(encryptJson(v, key), key)).toEqual(v);
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("data", key);
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const enc = encryptSecret("data", key);
    expect(() => decryptSecret(enc, randomBytes(32).toString("base64"))).toThrow();
  });

  it("rejects an invalid key length", () => {
    expect(() => encryptSecret("x", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });
});
