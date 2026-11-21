import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUrl, totpCode, verifyTotp } from "./totp";

// RFC 6238 appendix B: ASCII secret "12345678901234567890", SHA-1.
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors (last 6 digits of the 8-digit values)", () => {
    expect(totpCode(rfcSecret, 59_000)).toBe("287082");
    expect(totpCode(rfcSecret, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(rfcSecret, 1_234_567_890_000)).toBe("005924");
  });

  it("base32 round-trips", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(() => base32Decode("not base32!")).toThrow();
  });

  it("accepts the current and adjacent steps but not older ones or bad formats", () => {
    const t = 1_700_000_000_000;
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, t), t)).toBe(true);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, t - 30_000), t)).toBe(true);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, t + 30_000), t)).toBe(true);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, t - 90_000), t)).toBe(false);
    expect(verifyTotp(rfcSecret, "12345", t)).toBe(false);
    expect(verifyTotp(rfcSecret, "abcdef", t)).toBe(false);
  });

  it("builds an otpauth URL", () => {
    const url = otpauthUrl("ABC", "a@b.co");
    expect(url).toContain("otpauth://totp/MK%20AI%20Travel%3Aa%40b.co");
    expect(url).toContain("secret=ABC");
  });
});
