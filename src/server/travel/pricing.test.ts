import { describe, expect, it } from "vitest";
import { calculatePackagePrice, PricingError } from "./pricing";

const line = (name: string, unitCost: number, quantity = 1, currency = "INR") => ({ name, unitCost, quantity, currency });

describe("calculatePackagePrice", () => {
  it("applies markup, then tax on the marked-up amount", () => {
    const r = calculatePackagePrice({
      lines: [line("Hotel", 1000, 2), line("Safari", 500, 3)],
      markup: { percentage: 10, fixedAmount: 100 },
      taxPercent: 18,
    });
    expect(r.subtotal).toBe(3500);
    expect(r.markup).toBe(450); // 350 + 100
    expect(r.taxes).toBe(711); // 18% of 3950
    expect(r.total).toBe(4661);
    expect(r.currency).toBe("INR");
  });

  it("does not drift on awkward decimals", () => {
    const r = calculatePackagePrice({ lines: [line("A", 0.1, 3)] });
    expect(r.subtotal).toBe(0.3);
    expect(r.total).toBe(0.3);
  });

  it("subtracts discount before tax", () => {
    const r = calculatePackagePrice({ lines: [line("A", 1000)], discount: 100, taxPercent: 10 });
    expect(r.taxes).toBe(90);
    expect(r.total).toBe(990);
  });

  it("rejects mixed currencies rather than guessing a rate", () => {
    expect(() => calculatePackagePrice({ lines: [line("A", 1, 1, "INR"), line("B", 1, 1, "USD")] })).toThrow(PricingError);
  });

  it("rejects empty, negative and invalid input", () => {
    expect(() => calculatePackagePrice({ lines: [] })).toThrow(PricingError);
    expect(() => calculatePackagePrice({ lines: [line("A", -1)] })).toThrow(PricingError);
    expect(() => calculatePackagePrice({ lines: [line("A", 1, 0)] })).toThrow(PricingError);
    expect(() => calculatePackagePrice({ lines: [line("A", 100)], discount: 500 })).toThrow(PricingError);
  });
});
