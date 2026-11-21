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

describe("GST split", () => {
  const lines = [{ name: "Package", unitCost: 1000, quantity: 1, currency: "INR" }];

  it("splits intra-state GST into CGST and SGST halves", () => {
    const p = calculatePackagePrice({ lines, gst: { ratePercent: 18, supply: "INTRA_STATE" } });
    expect(p.taxLines).toEqual([
      { label: "CGST", ratePercent: 9, amount: 90 },
      { label: "SGST", ratePercent: 9, amount: 90 },
    ]);
    expect(p.taxes).toBe(180);
    expect(p.total).toBe(1180);
  });

  it("charges IGST for inter-state supply", () => {
    const p = calculatePackagePrice({ lines, gst: { ratePercent: 5, supply: "INTER_STATE" } });
    expect(p.taxLines).toEqual([{ label: "IGST", ratePercent: 5, amount: 50 }]);
    expect(p.total).toBe(1050);
  });

  it("never loses or invents a paisa when the tax is an odd number of paise", () => {
    // 333.33 * 5% = 16.6665 -> 1667 paise; halves 833 + 834 must add back to exactly 1667.
    const p = calculatePackagePrice({
      lines: [{ name: "x", unitCost: 333.33, quantity: 1, currency: "INR" }],
      gst: { ratePercent: 5, supply: "INTRA_STATE" },
    });
    expect(p.taxes).toBeCloseTo(p.taxLines[0].amount + p.taxLines[1].amount, 10);
    expect(Math.round(p.taxes * 100)).toBe(1667);
    expect(Math.round(p.total * 100)).toBe(33333 + 1667);
  });

  it("taxes after markup and discount", () => {
    const p = calculatePackagePrice({
      lines,
      markup: { percentage: 10 },
      discount: 100,
      gst: { ratePercent: 10, supply: "INTER_STATE" },
    });
    expect(p.taxable).toBe(1000);
    expect(p.taxes).toBe(100);
    expect(p.total).toBe(1100);
  });

  it("rejects combining tax modes and out-of-range rates", () => {
    expect(() => calculatePackagePrice({ lines, taxPercent: 5, gst: { ratePercent: 5, supply: "INTER_STATE" } })).toThrow(PricingError);
    expect(() => calculatePackagePrice({ lines, gst: { ratePercent: 150, supply: "INTER_STATE" } })).toThrow(PricingError);
    expect(() => calculatePackagePrice({ lines, gst: { ratePercent: -1, supply: "INTER_STATE" } })).toThrow(PricingError);
  });

  it("keeps the legacy single tax line", () => {
    const p = calculatePackagePrice({ lines, taxPercent: 18 });
    expect(p.taxLines).toEqual([{ label: "Tax", ratePercent: 18, amount: 180 }]);
  });
});
