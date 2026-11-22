import { describe, expect, it, vi } from "vitest";
import { fingerprint, recordError, redact } from "./errors";

describe("redact", () => {
  it("removes emails, urls, tokens, long ids and long numbers", () => {
    const out = redact(
      "user a.b@example.com failed on postgresql://u:p@host/db with Bearer abcdefgh12345678 id cmwrerv8x0000abcdefghijkl order 123456789 key_abcdefghijkl"
    );
    expect(out).not.toMatch(/example\.com|postgresql|abcdefgh12345678|cmwrerv8x|123456789|abcdefghijkl|cmwrerv8x0000/);
    expect(out).toContain("[email]");
    expect(out).toContain("[url]");
  });
});

describe("fingerprint", () => {
  it("groups the same error even when ids and line numbers differ", () => {
    const a = fingerprint("TypeError", "bad thing for user x@y.com", "TypeError\n    at foo (src/a.ts:10:5)");
    const b = fingerprint("TypeError", "bad thing for user q@z.org", "TypeError\n    at foo (src/a.ts:99:1)");
    expect(a).toBe(b);
    expect(fingerprint("TypeError", "other", "TypeError\n    at foo (src/a.ts:10:5)")).not.toBe(a);
  });
});

describe("recordError", () => {
  it("stores a redacted error with an upsert that counts repeats and reopens resolved ones", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const ok = await recordError(new Error("fail for me@x.com"), { source: "route", route: "/api/x?token=secret" }, { errorLog: { upsert } } as never);
    expect(ok).toBe(true);
    const arg = upsert.mock.calls[0][0];
    expect(arg.create.message).toBe("fail for [email]");
    expect(arg.create.route).toBe("/api/x");
    expect(arg.update.count).toEqual({ increment: 1 });
    expect(arg.update.resolvedAt).toBeNull();
  });

  it("never throws, even if the database is down or a non-error is thrown", async () => {
    const upsert = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(recordError("plain string", { source: "server" }, { errorLog: { upsert } } as never)).resolves.toBe(false);
    await expect(recordError(undefined, { source: "server" }, { errorLog: { upsert: vi.fn().mockResolvedValue({}) } } as never)).resolves.toBe(true);
  });
});
