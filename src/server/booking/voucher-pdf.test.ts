import { describe, expect, it } from "vitest";
import { describeCancellation } from "./voucher-pdf";

describe("describeCancellation", () => {
  it("says when the supplier published no policy instead of inventing one", () => {
    expect(describeCancellation([])[0]).toMatch(/did not publish/);
  });
  it("lists the supplier tiers, longest notice first, with the supplier's own numbers", () => {
    const out = describeCancellation([
      { hours: 24, percents: 50 },
      { hours: 72, percents: 100 },
    ]);
    expect(out[0]).toContain("72 hours");
    expect(out[0]).toContain("100%");
    expect(out[1]).toContain("24 hours");
    expect(out[1]).toContain("50%");
  });
});
